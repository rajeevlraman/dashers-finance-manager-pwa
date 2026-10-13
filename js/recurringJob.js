// recurringjob.js - ENHANCED VERSION

import { getAllItems, addItem, updateItem, STORE_NAMES, generateId } from './db.js';
import { computeAccountBalance } from './accountBalance.js';
import { processLoanPayment } from './loans.js';

import { formatMoney, stampAud, transferLegs } from './utils/currency.js';
import { findRealTransactionFor, isUncategorised } from './recurringMatch.js';
export class RecurringJobManager {
    constructor() {
        this.processedCount = 0;
        this.errors = [];
    }

    async processAll() {
        
        try {
            const results = {
                recurringTransactions: await this.processRecurringTransactions(),
                dueBills: await this.processDueBills()
            };

            
            if (this.errors.length > 0) {
                console.warn(`⚠️ ${this.errors.length} errors encountered:`, this.errors);
            }
            
            return {
                success: true,
                processed: this.processedCount,
                errors: this.errors,
                details: results
            };
        } catch (error) {
            console.error('❌ Processing failed:', error);
            return {
                success: false,
                processed: this.processedCount,
                errors: [...this.errors, error.message]
            };
        }
    }

    async processRecurringTransactions() {
        const [recList, accounts, existingTransactions] = await Promise.all([
            getAllItems(STORE_NAMES.recurringTransactions),
            getAllItems(STORE_NAMES.accounts),
            getAllItems(STORE_NAMES.transactions)
        ]);

        const todayStr = new Date().toISOString().slice(0, 10);
        const processed = [];

        for (const rec of recList) {
            try {
                // Get every due date between where this recurring entry left
                // off (rec.lastProcessed / rec.catchUpFrom) and today — not
                // just "is it due right now". A recurring entry whose
                // startDate is a year in the past will therefore generate
                // one entry per missed period (e.g. 12 monthly payments),
                // not a single one dated today.
                const duePeriods = this.getDuePeriods(rec, todayStr, existingTransactions);

                for (const dueDate of duePeriods) {
                    // Guard against re-processing a period that's already
                    // been recorded (e.g. the job was interrupted partway
                    // through a catch-up run and is now resuming).
                    const alreadyExists = existingTransactions.some(tx =>
                        tx.recurringId === rec.id && tx.date === dueDate
                    );
                    if (alreadyExists) {
                        rec.lastProcessed = dueDate;
                        continue;
                    }

                    let transaction;

                    if (rec.loanId) {
                        // This recurring entry is a real loan repayment (see
                        // the "Link to Loan" field) — route it through the
                        // same logic the Loans page's "Make Payment" button
                        // uses, so it properly splits principal vs interest
                        // and reduces the loan's own balance, not just the
                        // paying account's. A plain recurring transaction
                        // would only ever do the latter.
                        //
                        // Calling this once per missed period, in date order,
                        // is what makes catch-up correct for loans: each call
                        // recalculates interest off loan.currentBalance as it
                        // stands *after* the previous missed payment, so a
                        // 12-payment backlog amortizes the same way it would
                        // have if paid on time, rather than being collapsed
                        // into one lump payment on today's balance.
                        const accountId = await this.getSmartAccountId(rec, accounts);
                        const result = await processLoanPayment(rec.loanId, {
                            amount: rec.amount,
                            fromAccountId: accountId,
                            paymentDate: dueDate,
                            recurringId: rec.id,
                            categoryId: rec.categoryId,
                            autoMinimum: !!rec.autoMinimum
                        });
                        if (result.reconciled) {
                            const bankRow = existingTransactions.find(tx => tx.id === result.transactionId);
                            if (bankRow) {
                                Object.assign(bankRow, {
                                    loanId: rec.loanId,
                                    loanTransactionId: result.loanTransactionId || bankRow.loanTransactionId,
                                    recurringId: rec.id,
                                    reconciled: true
                                });
                            }
                            rec.lastProcessed = dueDate;
                            await updateItem(STORE_NAMES.recurringTransactions, rec);
                            this.reconciledCount = (this.reconciledCount || 0) + 1;
                            continue;
                        }
                        transaction = {
                            description: `Auto loan payment: ${rec.name}`,
                            date: dueDate,
                            principal: result.principal,
                            interest: result.interest,
                            newLoanBalance: result.newBalance
                        };
                    } else {
                        // The payment has (or will have) a real row from the bank.
                        // If one already exists, adopt it instead of generating a
                        // second copy — see recurringMatch.js.
                        const matchAccountId = await this.getSmartAccountId(rec, accounts);
                        const real = findRealTransactionFor(
                            { accountId: matchAccountId, type: rec.type, amount: rec.amount, dueDate },
                            existingTransactions
                        );
                        if (real) {
                            const adopted = {
                                ...real,
                                recurringId: rec.id,
                                reconciled: true,
                                ...(isUncategorised(real.categoryId) && rec.categoryId ? { categoryId: rec.categoryId } : {}),
                                updatedAt: new Date().toISOString()
                            };
                            await updateItem(STORE_NAMES.transactions, adopted);
                            Object.assign(real, adopted);
                            rec.lastProcessed = dueDate;
                            await updateItem(STORE_NAMES.recurringTransactions, rec);
                            this.reconciledCount = (this.reconciledCount || 0) + 1;
                            continue;
                        }
                        transaction = await this.createRecurringTransaction(rec, accounts, dueDate);
                        await addItem(STORE_NAMES.transactions, await stampAud(transaction));
                        existingTransactions.push(transaction);
                    }

                    // Persist progress after each period (not just once at
                    // the end) so a long catch-up run that errors or gets
                    // interrupted partway resumes from where it stopped
                    // instead of re-running periods that already succeeded.
                    rec.lastProcessed = dueDate;
                    await updateItem(STORE_NAMES.recurringTransactions, rec);

                    processed.push(transaction);
                    this.processedCount++;
                }
            } catch (error) {
                this.errors.push(`Recurring ${rec.name}: ${error.message}`);
                console.error(`❌ Failed to process ${rec.name}:`, error);
            }
        }

        return {
            processed: processed.length,
            transactions: processed
        };
    }

    // Returns every due date (oldest first) between this recurring entry's
    // anchor point and today, inclusive. The anchor is, in priority order:
    // rec.lastProcessed (normal steady-state case), then rec.catchUpFrom (an
    // optional user-set "I've already got this covered up to here" date —
    // see the Recurring form's "Already paid up to" field, useful when
    // you're importing historical transactions that already include some of
    // these payments and don't want them duplicated), then rec.startDate
    // (brand-new entry, never processed).
    getDuePeriods(rec, todayStr, existingTransactions) {
        const dates = [];
        const today = new Date(todayStr);

        const anchor = rec.lastProcessed || rec.catchUpFrom || rec.startDate;
        let cursor = new Date(anchor);

        // If this entry has literally never been processed and has no
        // catch-up override, the very first payment is due on startDate
        // itself, not one period after it.
        if (!rec.lastProcessed && !rec.catchUpFrom && anchor === rec.startDate) {
            if (cursor <= today) dates.push(this.toDateStr(cursor));
        }

        // Safety cap: however far back the anchor is, never generate more
        // than ~1000 periods in one run (e.g. ~19 years of weekly payments).
        // This is a guard against a mis-set date creating a runaway loop,
        // not an expected limit in normal use.
        for (let i = 0; i < 1000; i++) {
            const next = new Date(cursor);
            this.advance(next, rec.frequency);
            if (next > today) break;
            dates.push(this.toDateStr(next));
            cursor = next;
        }

        return dates;
    }

    advance(date, freq) {
        switch (freq) {
            case 'weekly':
                date.setDate(date.getDate() + 7);
                break;
            case 'fortnightly':
                date.setDate(date.getDate() + 14);
                break;
            case 'monthly':
                date.setMonth(date.getMonth() + 1);
                break;
            case 'quarterly':
                date.setMonth(date.getMonth() + 3);
                break;
            case 'halfyearly':
                date.setMonth(date.getMonth() + 6);
                break;
            case 'annually':
                date.setFullYear(date.getFullYear() + 1);
                break;
            default:
                date.setMonth(date.getMonth() + 1);
        }
    }

    toDateStr(date) {
        return date.toISOString().slice(0, 10);
    }

    async createRecurringTransaction(rec, accounts, dueDate) {
        const accountId = await this.getSmartAccountId(rec, accounts);
        
        return {
            id: generateId(),
            type: rec.type,
            amount: rec.type === 'income' ? rec.amount : -rec.amount,
            date: dueDate,
            categoryId: rec.categoryId,
            accountId: accountId,
            description: `Auto: ${rec.name}`,
            recurringId: rec.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    async processDueBills() {
        const [bills, accounts, categories, transactions] = await Promise.all([
            getAllItems(STORE_NAMES.bills),
            getAllItems(STORE_NAMES.accounts),
            getAllItems(STORE_NAMES.categories),
            getAllItems(STORE_NAMES.transactions)
        ]);

        const today = new Date().toISOString().slice(0, 10);
        const processed = [];

        for (const bill of bills.filter(b => !b.paid && b.dueDate <= today)) {
            try {
                // A recurring bill only creates ONE next instance per pay
                // (createNextBillInstance), so if several occurrences have
                // been missed (e.g. the app wasn't opened for months), each
                // one needs to be paid and rolled forward in turn, in the
                // same run — otherwise it only catches up by one occurrence
                // per app load. Cap at 1000 as a safety net against a
                // mis-set date creating a runaway loop, not an expected
                // limit in normal use.
                let current = bill;
                for (let i = 0; i < 1000; i++) {
                    const result = await this.processBillPayment(current, accounts, categories, current.dueDate, transactions);
                    if (result) {
                        processed.push(result);
                        this.processedCount++;
                    }
                    if (!current.recurring) break;
                    const nextDueDate = this.getNextDueDate(current.dueDate, current.recurring);
                    if (nextDueDate > today) break;
                    // createNextBillInstance() already ran inside
                    // processBillPayment (it's called whenever bill.recurring
                    // is set); fetch that freshly-created row so we can pay
                    // it too in this same pass.
                    const allBills = await getAllItems(STORE_NAMES.bills);
                    current = allBills.find(b => b.name === current.name && b.dueDate === nextDueDate && !b.paid);
                    if (!current) break;
                }
            } catch (error) {
                this.errors.push(`Bill ${bill.name}: ${error.message}`);
                console.error(`❌ Failed to process bill ${bill.name}:`, error);
            }
        }

        return {
            processed: processed.length,
            bills: processed
        };
    }

    async processBillPayment(bill, accounts, categories, today, transactions) {
        // Check if bill has payment account
        if (!bill.accountId) {
            return null;
        }

        const account = accounts.find(a => a.id === bill.accountId);
        if (!account) {
            throw new Error(`Account not found for bill: ${bill.name}`);
        }

        // Check if account has sufficient funds
        if (!this.canAccountPayBill(account, bill, transactions)) {
            return null;
        }

        // Create transaction(s)
        // If destinationAccountId is set, this bill is really a transfer
        // between two of your own accounts (e.g. a credit card payment
        // from an offset account) — record both sides so both balances
        // move correctly, matching the same logic used for manual payment
        // in bills.js.
        const categoryId = bill.categoryId || await this.getBillCategoryId(bill.name, categories);

        if (bill.destinationAccountId) {
            const transferGroupId = generateId();
            // Cross-currency: convert the received side at the stored rate (same figure if no rate is set).
            const destAccount = accounts.find(a => a.id === bill.destinationAccountId);
            const legs = transferLegs(bill.amount, account.currency, destAccount?.currency);
            const outTx = {
                id: generateId(),
                type: 'expense',
                amount: -bill.amount,
                date: today,
                categoryId,
                accountId: bill.accountId,
                description: `Bill: ${bill.name}`,
                billId: bill.id,
                isTransfer: true,
                transferGroupId,
                transferDirection: 'out',
                ...legs.fx,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const inTx = {
                id: generateId(),
                type: 'income',
                amount: legs.received,
                date: today,
                categoryId,
                accountId: bill.destinationAccountId,
                description: `Bill: ${bill.name} (payment received)`,
                billId: bill.id,
                isTransfer: true,
                transferGroupId,
                transferDirection: 'in',
                ...legs.fx,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await addItem(STORE_NAMES.transactions, outTx);
            await addItem(STORE_NAMES.transactions, inTx);
        } else if (findRealTransactionFor(
            { accountId: bill.accountId, type: 'expense', amount: bill.amount, dueDate: bill.dueDate },
            transactions
        )) {
            // The bank row for this payment is already in the books (imported
            // or entered by hand): adopt it rather than adding a second copy.
            const real = findRealTransactionFor(
                { accountId: bill.accountId, type: 'expense', amount: bill.amount, dueDate: bill.dueDate },
                transactions
            );
            const adopted = {
                ...real,
                billId: bill.id,
                reconciled: true,
                ...(isUncategorised(real.categoryId) && categoryId ? { categoryId } : {}),
                ...(bill.propertyId ? { propertyId: bill.propertyId, isPropertyExpense: true } : {}),
                updatedAt: new Date().toISOString()
            };
            await updateItem(STORE_NAMES.transactions, adopted);
            Object.assign(real, adopted);
        } else {
            const transaction = {
                id: generateId(),
                type: 'expense',
                amount: -bill.amount,
                date: today,
                categoryId,
                accountId: bill.accountId,
                description: `Bill: ${bill.name}`,
                billId: bill.id,
                propertyId: bill.propertyId || '',
                isPropertyExpense: !!bill.propertyId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await addItem(STORE_NAMES.transactions, await stampAud(transaction));
        }

        // Update bill
        bill.paid = true;
        bill.paidDate = today;
        bill.updatedAt = new Date().toISOString();
        // Note: account.balance is no longer mutated directly — balances are
        // now always computed live as openingBalance + the sum of every
        // transaction against that account (see js/accountBalance.js). The
        // transaction(s) created above (already correctly signed) are what
        // move the balance(s); mutating account.balance here too would
        // double-count the payment.

        await updateItem(STORE_NAMES.bills, bill);

        // Handle recurring bills - CREATE NEXT INSTANCE
        if (bill.recurring) {
            await this.createNextBillInstance(bill, today);
        }

        
        return {
            bill: bill.name,
            amount: bill.amount,
            account: account.name,
            recurring: !!bill.recurring
        };
    }

    async createNextBillInstance(bill, today) {
        const nextDueDate = this.getNextDueDate(bill.dueDate, bill.recurring);
        
        const newBill = {
            id: generateId(),
            name: bill.name,
            amount: bill.amount,
            dueDate: nextDueDate,
            paid: false,
            recurring: bill.recurring,
            accountId: bill.accountId,
            categoryId: bill.categoryId,
            propertyId: bill.propertyId || '',
            destinationAccountId: bill.destinationAccountId || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await addItem(STORE_NAMES.bills, newBill);
    }

    canAccountPayBill(account, bill, transactions) {
        const liveBalance = computeAccountBalance(account, transactions);
        // Different rules for different account types
        switch (account.type) {
            case 'credit':
                // Credit cards can always "pay" (they go more negative)
                return true;
            case 'loan':
                // Loans might have restrictions
                return liveBalance >= bill.amount;
            case 'bank':
            case 'savings':
            case 'cash':
            default:
                // Regular accounts need sufficient balance
                return liveBalance >= bill.amount;
        }
    }

    async getSmartAccountId(recTransaction, accounts) {
        if (recTransaction.accountId) {
            return recTransaction.accountId;
        }

        // Priority-based account selection
        const accountPriority = recTransaction.type === 'income' 
            ? ['savings', 'bank', 'investment']
            : ['credit', 'bank', 'cash'];

        for (const type of accountPriority) {
            const suitableAccount = accounts.find(acc => 
                acc.type === type && 
                (recTransaction.type === 'income' || this.canAccountPayBill(acc, { amount: recTransaction.amount }))
            );
            if (suitableAccount) return suitableAccount.id;
        }

        throw new Error('No suitable account found for transaction');
    }

    async getBillCategoryId(billName, categories) {
        const name = billName.toLowerCase();
        
        if (name.includes('electric') || name.includes('power') || name.includes('utility')) 
            return categories.find(c => c.name.toLowerCase().includes('utility'))?.id;
        if (name.includes('water') || name.includes('gas')) 
            return categories.find(c => c.name.toLowerCase().includes('utility'))?.id;
        if (name.includes('internet') || name.includes('phone') || name.includes('mobile'))
            return categories.find(c => c.name.toLowerCase().includes('utility'))?.id;
        if (name.includes('rent') || name.includes('mortgage'))
            return categories.find(c => c.name.toLowerCase().includes('rent'))?.id;
        
        return categories.find(c => c.name.toLowerCase().includes('other'))?.id;
    }

    getNextDueDate(currentDateStr, freq) {
        const d = new Date(currentDateStr);
        switch (freq) {
            case 'weekly':
                d.setDate(d.getDate() + 7);
                break;
            case 'fortnightly':
                d.setDate(d.getDate() + 14);
                break;
            case 'monthly':
                d.setMonth(d.getMonth() + 1);
                break;
            case 'quarterly':
                d.setMonth(d.getMonth() + 3);
                break;
            case 'halfyearly':
                d.setMonth(d.getMonth() + 6);
                break;
            case 'annually':
                d.setFullYear(d.getFullYear() + 1);
                break;
        }
        return d.toISOString().slice(0, 10);
    }

    formatCurrency(amount) {
        return formatMoney(Math.abs(amount));
    }
}

// Backwards compatibility - keep your existing functions
export async function processRecurringTransactions() {
    const manager = new RecurringJobManager();
    const result = await manager.processRecurringTransactions();
    return result.processed;
}

export async function processDueBills() {
    const manager = new RecurringJobManager();
    const result = await manager.processDueBills();
    return result.processed;
}

// New unified processing function
export async function processAllRecurring() {
    const manager = new RecurringJobManager();
    return await manager.processAll();
}