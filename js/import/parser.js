// ============================================================================
// parser.js - Unified Bank Parser with Merchant Extraction + Bank Category
// ============================================================================

import { detectBankFormat, looksLikeHeaderlessANZFormat } from './bankFormats.js';
import { parsePdfStatement, tidyDescription, extractBankReference } from './pdfStatement.js';

/* -------------------------------------------------------------
   NORMALISATION HELPERS
------------------------------------------------------------- */

const MONTH_NAMES = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

export function normaliseDescription(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Bug fix: this used to just take the first 1-3 words of the cleaned
// description. Real Australian bank statement lines are usually formatted
// as "<transaction type prefix> <merchant name> <reference/location/date
// suffix>" — e.g. "EFTPOS PURCHASE VISA DEBIT WOOLWORTHS 1234 MELBOURNE" —
// so blindly taking the first words captured "eftpos purchase visa"
// instead of "woolworths". That broke merchant-based auto-learning, since
// it was learning generic transaction-type noise instead of merchant
// names. This strips known prefixes/suffixes first, then takes the
// remaining "core" text as the merchant.
const LEADING_NOISE_PHRASES = [
    "eftpos purchase visa debit", "eftpos purchase debit", "eftpos purchase",
    "eftpos debit", "eftpos",
    "visa debit purchase", "visa purchase", "visa credit",
    "debit card purchase", "card purchase", "pos purchase",
    "direct debit", "direct credit", "direct entry",
    // Bug fix: "ANZ INTERNET BANKING BPAY <biller name> {ref}" is ANZ's
    // standard BPAY line format. "internet banking" here just describes
    // the payment CHANNEL (their online banking platform) - it says
    // nothing about what the payment was actually for.
    "anz internet banking", "internet banking",
    "bpay payment", "bpay",
    "internet transfer", "osko payment", "npp payment",
    "automatic payment", "scheduled payment",
    "transfer to", "transfer from", "withdrawal",
    // Income/salary prefixes — without these, a salary deposit like
    // "PAY/SALARY FROM GCP" normalises to "pay salary from gcp" and the
    // employer name gets buried behind boilerplate instead of surfacing
    // as the transaction's displayed name the way "Amazon" or "KFC" do
    // for expenses.
    "pay salary from", "salary from", "wages from", "wage from",
    "payroll from", "salary credit from", "salary payment from",
    "salary", "payroll"
];

const TRAILING_NOISE_WORDS = new Set([
    "vic", "nsw", "qld", "wa", "sa", "tas", "act", "nt",
    "aus", "aust", "australia", "au",
    "pty", "ltd"
]);

// Generic connector words that are never themselves part of a merchant or
// employer name (unlike TRAILING_NOISE_WORDS above, these are dropped
// wherever they appear in the description, not just at the end) — e.g.
// "PAY/SALARY FROM DEPARTMENT OF ED" should surface "department ed", not
// "department of ed".
const GENERIC_STOPWORDS = new Set(["of", "the"]);

// Bank amounts arrive in many shapes: "1,00,000.00" (Indian grouping), "₹1,250.50",
// "Rs. 500", "INR 75", "(45.00)", "1250.00 Dr". Strip the noise, keep the sign.
// Returns NaN when nothing numeric is left, exactly like parseFloat.
function parseMoney(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bdr\.?\s*$/i.test(s)) neg = true;
  s = s.replace(/\s*(cr|dr)\.?\s*$/i, '')
       .replace(/rs\.?|inr|aud|usd|eur|gbp|[₹$€£¥]/gi, '')
       .replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return neg && !isNaN(n) ? -Math.abs(n) : n;
}

function stripLeadingNoise(clean) {
    let result = clean;
    let changed = true;
    let guard = 0;
    // Loop: a real description can stack more than one noise phrase, e.g.
    // "anz internet banking" (channel) followed by "bpay" (payment method)
    // - a single pass would only strip the first and leave the second.
    while (changed && guard < 5) {
        changed = false;
        guard++;
        for (const phrase of LEADING_NOISE_PHRASES) {
            if (result.startsWith(phrase + " ")) {
                result = result.slice(phrase.length).trim();
                changed = true;
                break;
            }
            if (result === phrase) {
                return "";
            }
        }
    }
    return result;
}

// Bug fix: category matching needs a LIGHTER strip than merchant extraction.
// Words like "bpay" and "direct debit" describe how a payment was made,
// which is meaningless for a *merchant name* (so LEADING_NOISE_PHRASES
// strips them there) - but they're also the literal names of real
// categories ("BPAY Payments", "Direct Debits"), so stripping them before
// category matching would throw away a genuinely useful signal. This only
// strips pure channel descriptors that never correspond to a category.
const CATEGORY_NOISE_PHRASES = [
    "eftpos purchase visa debit", "eftpos purchase debit", "eftpos purchase",
    "eftpos debit", "eftpos",
    "visa debit purchase", "visa purchase", "visa credit",
    "debit card purchase", "pos purchase",
    "anz internet banking", "internet banking",
];

function stripCategoryNoise(clean) {
    for (const phrase of CATEGORY_NOISE_PHRASES) {
        if (clean.startsWith(phrase + " ")) {
            return clean.slice(phrase.length).trim();
        }
        if (clean === phrase) {
            return "";
        }
    }
    return clean;
}

function stripNoiseTokens(words) {
    return words.filter((w, idx) => {
        const isPureNumber = /^\d+$/.test(w);
        const looksLikeDate = /^\d{1,2}[a-z]{3}$/.test(w) || /^\d{4,8}$/.test(w);

        // Bug fix: a bare number was always treated as reference-number
        // noise and stripped, which mangled merchant names that start
        // with a digit — e.g. "7-Eleven" normalised to the words
        // ["7", "eleven"], and the "7" got removed as noise, leaving just
        // "eleven". Bank reference numbers realistically sit after the
        // merchant name, not before it, so a leading number is kept as
        // long as there's other text alongside it (a lone leading number
        // with nothing else, e.g. "DIRECT DEBIT 12345" after its prefix
        // is stripped, still falls through to the noise-only fallback
        // further down).
        if (isPureNumber && idx === 0 && words.length > 1) {
            return true;
        }

        return !isPureNumber && !looksLikeDate &&
            !TRAILING_NOISE_WORDS.has(w) && !GENERIC_STOPWORDS.has(w);
    });
}

export function extractMerchant(description) {
    const clean = normaliseDescription(description);
    const withoutLeadingNoise = stripLeadingNoise(clean);
    const words = withoutLeadingNoise.split(" ").filter(Boolean);
    // Bug fix: this used to only strip a contiguous run of noise tokens
    // from the very END of the word list, so a reference number sitting
    // BEFORE a trailing suburb name (e.g. "WOOLWORTHS 1234 MELBOURNE")
    // never got removed, since the stripping loop stopped as soon as it
    // hit "melbourne" (a normal-looking word) without ever reaching
    // "1234". Now it filters noise tokens from anywhere in the string.
    const coreWords = stripNoiseTokens(words);

    if (coreWords.length === 0) {
        // Everything was noise (e.g. a bare "DIRECT DEBIT 1234") — fall
        // back to the original cleaned text rather than returning nothing.
        return clean.split(" ").slice(0, 3).join(" ");
    }

    // Cap length as a safety net against unusually long descriptions, but
    // don't aggressively truncate to 3 words anymore now that noise is
    // already stripped — real merchant names are sometimes 2-4 words
    // (e.g. "chemist warehouse", "guzman y gomez"). Note: this doesn't
    // strip suburb/city names (e.g. "melbourne") since that would need a
    // hardcoded gazetteer of AU place names — "woolworths melbourne" is
    // still a large improvement over the old "eftpos purchase visa" and
    // still matches correctly for logo/category lookups either way.
    return coreWords.slice(0, 5).join(" ");
}

export function extractCategoryText(description) {
    return stripCategoryNoise(normaliseDescription(description));
}

/* -------------------------------------------------------------
   PROPER CSV ROW SPLITTING (bug fix)
------------------------------------------------------------- */
// Bug fix: every parser below used to do `line.split(",")`, which breaks
// as soon as a quoted field contains a comma — e.g. a description exported
// as `"Woolworths, Melbourne"` would get split into TWO fields instead of
// one, shifting every column index after it for that row (wrong date,
// wrong amount, garbled description). This respects quotes properly,
// including escaped `""` quotes inside a quoted field (standard CSV).
export function splitCSVLine(line) {
    const fields = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"'; // escaped quote inside a quoted field
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ",") {
                fields.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
    }
    fields.push(current.trim());
    return fields;
}

/* -------------------------------------------------------------
   Build Final Transaction Object
------------------------------------------------------------- */

function buildTxObject({
    date,
    description,
    amount,
    type,
    source,
    originalLine,
    bankCategory = null
}) {
    const clean = normaliseDescription(description);
    // Bug fix: some bank exports (ANZ in particular) pad descriptions with
    // long runs of internal whitespace for fixed-width alignment, e.g.
    // "BPAY SROVIC LAND TAX               {822746}" — that's fine for
    // matching (cleanDescription already collapses it) but looked broken
    // displayed as-is in the UI. This trims runs of 2+ spaces down to one,
    // while rawDescription below still preserves the true original.
    const displayDescription = (description || "").replace(/ {2,}/g, " ").trim();

    return {
        date,
        description: displayDescription,
        rawDescription: description,
        cleanDescription: clean,
        merchant: extractMerchant(description),
        categoryText: extractCategoryText(description),

        amount,
        type,

        bankCategory,    // ⭐ new field
        source,
        originalLine
    };
}

/* -------------------------------------------------------------
   MAIN CSV PARSER
------------------------------------------------------------- */

export async function parseCSVFile(file, format) {

    // Bank statement PDFs (Date | Particulars | Withdrawals | Deposits | Balance)
    if (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf') {
        return parsePdfFile(file);
    }

    const text = await file.text();
    const lines = text.split("\n").filter(l => l.trim());

    if (lines.length === 0) {
        throw new Error("CSV file is empty");
    }

    let transactions = [];

    if (format === "auto") {

        // ANZ has no header row at all, so it can't be detected by reading
        // lines[0] as a header — check the shape of the first DATA row
        // instead, before trying header-based detection.
        if (looksLikeHeaderlessANZFormat(lines[0])) {
            transactions = parseANZ(lines);
        } else {
            const bankFormat = detectBankFormat(lines[0]);

            if (bankFormat?.bankId === "macquarie") {
                transactions = parseMacquarie(lines);
            } else if (bankFormat?.bankId === "nab") {
                transactions = parseNAB(lines);
            } else if (bankFormat) {
                // Any other header-based format without its own dedicated
                // parser falls back to the generic column-mapping parser.
                transactions = parseWithBankFormat(lines, bankFormat);
            } else {
                transactions = parseGenericCSV(lines);
            }
        }
    } else {
        switch (format) {
            case "macquarie":   transactions = parseMacquarie(lines); break;
            case "anz_generic": transactions = parseANZGeneric(lines); break;
            case "nab_generic": transactions = parseNABGeneric(lines); break;
            case "me_generic":  transactions = parseMEGeneric(lines); break;
            case "anz":         transactions = parseANZ(lines); break;
            case "commbank":    transactions = parseCommBank(lines); break;
            case "nab":         transactions = parseNAB(lines); break;
            case "westpac":     transactions = parseWestpac(lines); break;
            case "generic_csv": transactions = parseGenericCSV(lines); break;

            default:
                console.warn("[PARSER] Unknown format → generic CSV");
                transactions = parseGenericCSV(lines);
        }
    }

    return transactions;
}

/* -------------------------------------------------------------
   TEXT STATEMENT PARSER
------------------------------------------------------------- */

async function parsePdfFile(file) {
    const result = await parsePdfStatement(file);
    if (result.mismatched > 0) {
        console.warn('[PDF import] balance mismatches:', result.warnings);
        alert(`⚠️ PDF read: ${result.rows.length} transactions, but ${result.mismatched} of ${result.checked} rows did not match the running balance.\n\nThose rows are marked "review" in the preview. Check them against your statement before saving.`);
    }
    const txs = result.rows.map((r, i) => {
        const tx = buildTxObject({
            date: r.date,
            description: tidyDescription(r.description),
            amount: r.amount,
            type: r.amount > 0 ? "income" : "expense",
            bankCategory: null,
            source: "PDF Statement Import",
            originalLine: i + 1
        });
        tx.rawDescription = r.description;
        // The bank's own reference (e.g. "Chq: 500132195648") — saver.js uses it as the duplicate key.
        const ref = extractBankReference(r.description);
        if (ref) tx.reference = ref;
        if (r.flagged) tx.needsReview = true;
        return tx;
    });
    // Everything the import screen needs to tell the person what was (not) read: it travels as a property
    // on the array because callers map/spread the rows but pass the array itself along.
    txs.importMeta = {
        warnings: result.warnings,
        emptyPages: result.emptyPages,
        pageCount: result.pageCount,
        openingBalance: result.openingBalance,
        closingBalance: result.rows.length ? result.rows[result.rows.length - 1].balance : null,
        mismatched: result.mismatched,
        checked: result.checked,
        statementCurrency: result.statementCurrency
    };
    return txs;
}

export async function parseStatementText(text, format) {
    const lines = text.split("\n").filter(l => l.trim());
    if (!lines.length) throw new Error("No text to parse");

    let tx;

    switch (format) {
        case "anz":      tx = parseANZ(lines); break;
        case "commbank": tx = parseCommBank(lines); break;
        case "nab":      tx = parseNAB(lines); break;
        case "westpac":  tx = parseWestpac(lines); break;
        default:         tx = parseGenericText(lines);
    }

    // The bank parsers above expect that bank's exact CSV column layout. Text
    // copied from a statement or PDF usually isn't laid out that way, so if the
    // chosen bank's parser finds nothing, try the line-by-line text parser
    // before reporting "no transactions".
    if (!tx || !tx.length) tx = parseGenericText(lines);

    return tx;
}

/* -------------------------------------------------------------
   GENERIC BANK FORMAT PARSER (auto-match header)
------------------------------------------------------------- */

function parseWithBankFormat(lines, fmt) {
    const txs = [];

    for (let i = 1; i < lines.length; i++) {
        try {
            const parts = splitCSVLine(lines[i]);

            const rawDate = parts[fmt.dateIndex] || "";
            const description = parts[fmt.descriptionIndex] || "";
            const parsedDate = parseDate(rawDate);

            if (!description || !parsedDate) continue;

            let amount = 0;

            if (fmt.debitIndex >= 0 && fmt.creditIndex >= 0) {
                const debit = parseMoney(parts[fmt.debitIndex]) || 0;
                const credit = parseMoney(parts[fmt.creditIndex]) || 0;
                amount = credit > 0 ? credit : -Math.abs(debit);
            } else if (fmt.amountIndex >= 0) {
                amount = parseMoney(parts[fmt.amountIndex]) || 0;
            }

            if (amount === 0) continue;

            txs.push(
                buildTxObject({
                    date: parsedDate,
                    description,
                    amount,
                    type: amount > 0 ? "income" : "expense",
                    bankCategory: null,
                    source: `${fmt.bankId} Import`,
                    originalLine: i + 1
                })
            );

        } catch (e) {
            console.warn("[PARSER] Auto-format parse error line", i, e);
        }
    }

    return txs;
}

/* -------------------------------------------------------------
   BANK-SPECIFIC PARSERS
------------------------------------------------------------- */

// ---------------------------
// MACQUARIE BANK
// ---------------------------
export function parseMacquarie(lines) {
    const header = lines[0].toLowerCase();
    const startIndex = header.includes("date") ? 1 : 0;
    const txs = [];

    for (let i = startIndex; i < lines.length; i++) {
        const parts = splitCSVLine(lines[i]);
        if (parts.length < 10) continue;

        const date = parseDate(parts[0]);
        const description = parts[1];
        // Bug fix: this used to only read the parent Category column
        // (parts[3], e.g. "Food & Drink" or "Transportation") and threw
        // away the Subcategory column (parts[4]) entirely - but the
        // subcategory is far more specific (e.g. "Fast Food" vs "Groceries"
        // vs "Restaurants" are all just "Food & Drink" at the parent level).
        // Prefer the subcategory when present; fall back to the parent
        // category for rows where Macquarie didn't supply one.
        const subcategory = (parts[4] || '').trim();
        const category = (parts[3] || '').trim();
        const bankCategory = subcategory || category || null;

        const debit = parseMoney(parts[7]) || 0;
        const credit = parseMoney(parts[8]) || 0;
        const amount = credit > 0 ? credit : -Math.abs(debit);

        if (!date || !description || amount === 0) continue;

        txs.push(
            buildTxObject({
                date,
                description,
                amount,
                type: amount > 0 ? "income" : "expense",
                bankCategory,
                source: "Macquarie Import",
                originalLine: i + 1
            })
        );
    }

    return txs;
}

// ---------------------------
// ANZ GENERIC FORMAT
// ---------------------------
export function parseANZGeneric(lines) {
    return parseWithBankFormat(lines, {
        bankId: "anz_generic",
        dateIndex: 0,
        descriptionIndex: 1,
        debitIndex: 2,
        creditIndex: 3
    });
}

// ---------------------------
// NAB GENERIC
// ---------------------------
// Bug fix: this was referenced in parseCSVFile()'s format switch (the
// "nab_generic" case) but was never actually defined — selecting it would
// have thrown a ReferenceError and crashed the import. Not currently
// reachable through the UI's dropdown, but a landmine if it ever is.
export function parseNABGeneric(lines) {
    return parseWithBankFormat(lines, {
        bankId: "nab_generic",
        dateIndex: 0,
        descriptionIndex: 1,
        amountIndex: 2,
        debitIndex: -1,
        creditIndex: -1
    });
}

// ---------------------------
// ME BANK GENERIC
// ---------------------------
export function parseMEGeneric(lines) {
    return parseWithBankFormat(lines, {
        bankId: "me_generic",
        dateIndex: 0,
        descriptionIndex: 1,
        amountIndex: 2,
        debitIndex: -1,
        creditIndex: -1
    });
}

// ---------------------------
// NAB (matches your CSV export)
// ---------------------------
export function parseNAB(lines) {

    const header = lines[0].toLowerCase();
    const startIndex = header.includes("date") ? 1 : 0;

    const txs = [];

    for (let i = startIndex; i < lines.length; i++) {
        const parts = splitCSVLine(lines[i]);

        if (parts.length < 2) continue;

        const rawDate = parts[0];
        const rawAmount = parts[1];
        const txnDetails = parts[5] || "";
        const merchantName = parts[8] || "";
        const bankCategory = parts[7] || null;

        const date = parseDate(rawDate);
        const amount = parseMoney(rawAmount);

        if (!date || isNaN(amount) || amount === 0) continue;

        const description =
            merchantName.trim() ||
            txnDetails.trim() ||
            `NAB Transaction ${i}`;

        txs.push(
            buildTxObject({
                date,
                description,
                amount,
                type: amount > 0 ? "income" : "expense",
                bankCategory,
                source: "NAB Import",
                originalLine: i + 1
            })
        );
    }

    return txs;
}

// ---------------------------
// ANZ
// ---------------------------
// Bug fix: this used to assume a 4-column layout with a header row and
// separate debit/credit columns. Real ANZ exports have NO header row at
// all and exactly 3 columns: date, an already-signed amount (negative for
// debits, positive for credits), and description — e.g.:
//   08/07/2026,"1771.42",PAY/SALARY FROM DEPARTMENT OF ED 10690383
//   07/07/2026,"-705.00",ANZ INTERNET BANKING BPAY SROVIC LAND TAX {822746}
export function parseANZ(lines) {
    const txs = [];

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i] || !lines[i].trim()) continue;
        const parts = splitCSVLine(lines[i]);
        if (parts.length < 3) continue;

        const date = parseDate(parts[0]);
        const amount = parseMoney(parts[1]);
        const description = parts.slice(2).join(", "); // description itself may have had a comma inside quotes

        if (!date || isNaN(amount) || amount === 0 || !description) continue;

        txs.push(
            buildTxObject({
                date,
                description,
                amount,
                type: amount > 0 ? "income" : "expense",
                bankCategory: null,
                source: "ANZ Import",
                originalLine: i + 1
            })
        );
    }

    return txs;
}

// ---------------------------
// COMM BANK
// ---------------------------
export function parseCommBank(lines) {
    const startIndex = lines[0].toLowerCase().includes("date") ? 1 : 0;
    const txs = [];

    for (let i = startIndex; i < lines.length; i++) {
        const parts = splitCSVLine(lines[i]);
        if (parts.length < 3) continue;

        const date = parseDate(parts[0]);
        const description = parts[1];
        const amount = parseMoney(parts[2]);

        if (!date || !description || isNaN(amount) || amount === 0) continue;

        txs.push(
            buildTxObject({
                date,
                description,
                amount,
                type: amount > 0 ? "income" : "expense",
                bankCategory: null,
                source: "CommBank Import",
                originalLine: i + 1
            })
        );
    }

    return txs;
}

// ---------------------------
// WESTPAC
// ---------------------------
export function parseWestpac(lines) {
    const startIndex = lines[0].toLowerCase().includes("date") ? 1 : 0;
    const txs = [];

    for (let i = startIndex; i < lines.length; i++) {
        const parts = splitCSVLine(lines[i]);
        if (parts.length < 3) continue;

        const date = parseDate(parts[0]);
        const description = parts[1];
        const amount = parseMoney(parts[2]);

        if (!date || !description || isNaN(amount) || amount === 0) continue;

        txs.push(
            buildTxObject({
                date,
                description,
                amount,
                type: amount > 0 ? "income" : "expense",
                bankCategory: null,
                source: "Westpac Import",
                originalLine: i + 1
            })
        );
    }

    return txs;
}

/* -------------------------------------------------------------
   GENERIC CSV PARSER
------------------------------------------------------------- */

export function parseGenericCSV(lines) {

    const header = lines[0].toLowerCase();
    const startIndex = header.includes("date") ? 1 : 0;

    const txs = [];

    for (let i = startIndex; i < lines.length; i++) {
        try {
            let parts = splitCSVLine(lines[i]);

            if (parts.length < 2) continue;

            let date = parseDate(parts[0]);
            let description = parts[1];

            let amount = null;

            for (let j = 2; j < parts.length; j++) {
                const num = parseFloat(parts[j].replace(/[$,]/g, ""));
                if (!isNaN(num)) {
                    amount = num;
                    break;
                }
            }

            if (!date || !description || !amount || amount === 0) continue;

            txs.push(
                buildTxObject({
                    date,
                    description,
                    amount,
                    type: amount > 0 ? "income" : "expense",
                    bankCategory: null,
                    source: "Generic CSV Import",
                    originalLine: i + 1
                })
            );
        } catch {}
    }

    return txs;
}

/* -------------------------------------------------------------
   GENERIC TEXT PARSER
------------------------------------------------------------- */

export function parseGenericText(lines) {
    const txs = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        let date = new Date().toISOString().split("T")[0];
        let description = line.trim();

        const dateMatch = line.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
        if (dateMatch) date = parseDate(dateMatch[1]) || date;

        // Bug fixes:
        // 1. This never captured a leading "-", so a pasted line like
        //    "17/01/2026 Woolworths -85.32" parsed as +85.32 and was
        //    misclassified as income instead of an expense.
        // 2. The decimal point used to be optional (`\.?`), which let this
        //    match a bare 4-digit number like the "2026" in "17/01/2026"
        //    as if it were the dollar amount, before ever reaching the
        //    real amount later in the line. Requiring the decimal point
        //    means only an actual "12.34"-style amount can match.
        const amountMatch = line.match(/(-)?\$?([\d,]+\.\d{2})\b/);
        const amount = amountMatch
            ? parseFloat((amountMatch[1] || '') + amountMatch[2].replace(/,/g, ""))
            : 0;

        if (!amount) continue;

        txs.push(
            buildTxObject({
                date,
                description,
                amount,
                type: amount > 0 ? "income" : "expense",
                bankCategory: null,
                source: "Generic Text Import",
                originalLine: i + 1
            })
        );
    }

    return txs;
}

/* -------------------------------------------------------------
   DATE PARSING
------------------------------------------------------------- */

// Build YYYY-MM-DD from parts without going through toISOString(), which
// converts local midnight to UTC and shifts the date back a day in timezones
// ahead of UTC (e.g. Australia).
function isoFromParts(y, m, d) {
    const yy = String(y).padStart(4, '0');
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

export function parseDate(raw) {
    if (!raw) return null;

    let clean = raw.trim().replace(/["']/g, "");

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

    // DD/MM/YYYY
    let m = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        let [, d, mm, y] = m;
        if (y.length === 2) y = "20" + y;
        return isoFromParts(Number(y), Number(mm), Number(d));
    }

    // "DD Mon YYYY"/"DD Mon YY" (space-separated, e.g. "12 Jul 2026") or
    // "DD-Mon-YY"/"DD-Mon-YYYY" (hyphen-separated, e.g. "29-Jun-26") — both
    // show up in real NAB/Macquarie exports depending on locale/export
    // settings. Bug fix: this used to only match the space-separated
    // variant, so the hyphenated form (the literal format in the sample
    // files this app was tested against) still fell through to the native
    // `new Date(clean)` fallback below — which happens to work in
    // Node/V8-based browsers but isn't guaranteed by spec, so it's not
    // safe to rely on across every browser this PWA might run in. Both
    // separators are now parsed explicitly and deterministically.
    m = clean.match(/^(\d{1,2})[\s-]+([a-zA-Z]{3,})[\s-]+(\d{2,4})$/);
    if (m) {
        const [, d, monthName, yRaw] = m;
        let y = yRaw;
        const monthIndex = MONTH_NAMES[monthName.toLowerCase().slice(0, 3)];
        if (monthIndex !== undefined) {
            if (y.length === 2) y = "20" + y;
            return isoFromParts(Number(y), monthIndex + 1, Number(d));
        }
    }

    // fallback to Date()
    let dt = new Date(clean);
    if (!isNaN(dt.getTime())) return dt.toISOString().split("T")[0];

    return null;
}

/* -------------------------------------------------------------
   EXPORTS
------------------------------------------------------------- */

export function getSupportedFormats() {
    return [
        "auto",
        "macquarie",
        "anz_generic",
        "nab_generic",
        "me_generic",
        "anz",
        "commbank",
        "nab",
        "westpac",
        "generic_csv"
    ];
}

