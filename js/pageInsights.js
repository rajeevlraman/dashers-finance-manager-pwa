// pageInsights.js
//
// What the page coach (pageCoach.js) says when someone opens a page from the
// tour: one short "insight" about the page, then a step for every item worth knowing about that point at real
// items on the screen. Each step lists CSS selectors to try in order; the
// first one that is actually visible wins, and a step whose items are not on
// screen (an empty page, a hidden tab) is skipped quietly.
//
// Keep it short: a title of a few words and one or two plain sentences. Page
// names, icons and groups come from navItems.js, so only the words live here.
// tests/pageCoach.test.js checks every page in the menu has an entry and that
// every selector below still exists in that page's source.

// A selector may end in " >> some words": only an element whose text contains those words counts
// (used where many cards share one class). A step may carry click: a tab to open first.

// A selector may end in " >> some words": only an element whose text contains those words counts
// (used where many cards share one class). A step may carry click: a tab to open first.

// A selector may end in " >> some words": only an element whose text contains those words counts
// (used where many cards share one class). A step may carry click: a tab to open first.

// A selector may end in " >> some words": only an element whose text contains those words counts
// (used where many cards share one class). A step may carry click: a tab to open first.

// A selector may end in " >> some words": only an element whose text contains those words counts
// (used where many cards share one class). A step may carry click: a tab to open first.

// A selector may end in " >> some words": only an element whose text contains those words counts
// (used where many cards share one class). A step may carry click: a tab to open first.

export const PAGE_INSIGHTS = {
  'financial-dashboard': {
    insight: 'Your money trends in one place: how income and spending are moving, where it goes, and how you are tracking against budget.',
    steps: [
      { target: ['#pfdYearSelect'], title: 'Year', text: 'Choose the year. Every chart and total on this page follows it.' },
      { target: ['#pfdMonthSelect'], title: 'Month', text: 'Pick one month, or Full Year to see the whole year at once.' },
      { target: ['.pfd-accounts-summary'], title: 'Which accounts count', text: 'Open this and untick any account to leave it out of every chart and total.' },
      { target: ['.pfd-kpi-row'], title: 'Headline totals', text: 'Income, expenses, net savings, savings rate, budget use and balance for the period.' },
      { target: ['.pfd-item-income-expense'], title: 'Income vs expense', text: 'Month by month, so you can see where spending overtook income.' },
      { target: ['.pfd-item-expense-donut'], title: 'Expense by category', text: 'Which categories take the biggest slice of your spending.' },
      { target: ['.pfd-item-goals'], title: 'Savings goals', text: 'Saved against remaining for each goal. Edit a goal or add one from here.' },
      { target: ['.pfd-item-savings-progress'], title: 'Savings progress', text: 'How your savings have been building up over time.' },
      { target: ['.pfd-item-income-cat'], title: 'Income by category', text: 'Where your income comes from: salary, rent, interest and so on.' },
      { target: ['.pfd-item-by-account'], title: 'By account', text: 'How much moved through each account in the period.' },
      { target: ['.pfd-item-budget-actual'], title: 'Budget vs actual', text: 'Each budget next to what you really spent.' },
      { target: ['.pfd-item-payment-method'], title: 'Payment method', text: 'Card, cash or bank: how you pay for things.' },
      { target: ['.pfd-item-annual-plans'], title: 'Annual net savings', text: 'Income minus expenses for each year, so you can compare years.' },
      { target: ['.pfd-item-investments'], title: 'Investments and retirement', text: 'Your investments and a retirement estimate based on your funds.' },
      { target: ['.pfd-item-wealth-planning'], title: 'Wealth planning progress', text: 'Emergency fund, debt, investing and retirement checked off in one place.' },
      { target: ['#pfdRefreshBtn'], title: 'Refresh', text: 'Reloads the numbers after you have added or changed something.' },
    ],
  },

  'wealth-overview': {
    insight: 'Your net worth in one view: what you own minus what you owe, across accounts, property, loans and super.',
    steps: [
      { target: ['.wealth-hero-stat'], title: 'Your net worth', text: 'Everything you own minus everything you owe, with your savings rate for the month.' },
      { target: ['.wealth-stat-strip'], title: 'Key numbers', text: 'Investments, this month\'s savings and other headline figures at a glance.' },
      { target: ['.wealth-card >> Savings Tracker'], title: 'Savings tracker', text: 'Progress on your emergency fund. Use Edit goal to change the target.' },
      { target: ['.wealth-card >> Investment Contributions'], title: 'Investment contributions', text: 'What you are putting into investments each month.' },
      { target: ['.wealth-card >> Retirement Timeline'], title: 'Retirement timeline', text: 'Roughly when you could retire, using your super and savings.' },
      { target: ['.wealth-card >> Financial Goals'], title: 'Financial goals', text: 'Your goals and how close each one is.' },
      { target: ['.wealth-card >> Insurance Review'], title: 'Insurance review', text: 'A quick check of your policies and what they cost each year.' },
      { target: ['.wealth-card >> Annual Portfolio Review', '#wealthPortfolioChart'], title: 'Annual portfolio review', text: 'How your investments are split across types.' },
      { target: ['.wealth-card >> Net Worth Trend', '#wealthNetWorthTrendChart'], title: 'Net worth trend', text: 'Net worth over the last six months, including property and loans.' },
      { target: ['.wealth-card >> Fixed Rate Watch'], title: 'Fixed rate watch', text: 'Fixed-rate loans that are about to end, so you can shop around in time.' },
      { target: ['.wealth-card >> Wealth Planning Progress'], title: 'Wealth planning progress', text: 'A checklist of the basics: emergency fund, debt, investing, retirement.' },
    ],
  },

  'finance-overview': {
    insight: 'Your everyday home screen. Start here to see where you stand, what is coming up, and how the month is going.',
    steps: [
      { target: ['#foPrevMonth', '#foNextMonth'], title: 'Change the month', text: 'Step back or forward a month. Every card on this page follows it.' },
      { target: ['.fo-card-featured'], title: 'Your accounts', text: 'Your accounts as stacked cards with balances. Tap one behind to bring it to the front.' },
      { target: ['.fo-list-card'], title: 'What needs attention', text: 'Overdue and upcoming bills, recurring items, loans, insurance and rates in one list.' },
      { target: ['.fo-list-tab'], title: 'Switch the list', text: 'Tap a tab to change which list you are looking at.' },
      { target: ['#foMarkBillPaid'], title: 'Mark a bill paid', text: 'Pay off a bill right here when its details are showing.' },
      { target: ['.fo-card >> No goals set yet', '.fo-card >> Goals'], title: 'Goals', text: 'Saved so far against your goals this month.' },
      { target: ['.fo-card >> Cash Flow'], title: 'Cash flow', text: 'Income, expenses and savings rate for the month.' },
      { target: ['.fo-card >> Loan Totals'], title: 'Loan totals', text: 'How many loans you have, what is owed, and the monthly repayments.' },
      { target: ['.fo-card >> Insurance Totals'], title: 'Insurance totals', text: 'Policies, total yearly premiums and what renews soon.' },
      { target: ['.fo-card >> Property Rates', '#foRatesTaxPrevFY'], title: 'Property rates and taxes', text: 'Council rates and land tax by financial year. Use the arrows to change year.' },
      { target: ['.fo-tab', '#foInflowChart'], title: 'Inflow, costs and goals', text: 'Switch tabs to see where money came from and where it went.' },
      { target: ['#foBudgetDonut', '.fo-card >> Budgeted'], title: 'Budget', text: 'Your budget set against what came in, and how much is left over.' },
      { target: ['#foStructureRadar'], title: 'Structure', text: 'The shape of your spending, drawn as a radar chart.' },
      { target: ['.fo-card >> Recent Activity'], title: 'Recent activity', text: 'Your latest transactions. See all opens the full list.' },
      { target: ['#foCompareChart'], title: 'Compare', text: 'Costs, goals and inflow side by side across the year.' },
      { target: ['#foToggleGoals', '#foToggleInflow'], title: 'Chart switches', text: 'Tick or untick goals and inflow to simplify the comparison.' },
    ],
  },

  'transactions': {
    insight: 'Every dollar in and out, in one searchable list. This is where you add, fix, filter and import transactions.',
    steps: [
      { target: ['#txQuickYear'], title: 'Year', text: 'Narrow the list to one year, or leave it on All Time.' },
      { target: ['#txQuickMonth'], title: 'Month', text: 'Then pick a month, or Full Year.' },
      { target: ['#btnAddTx'], title: 'Add a transaction', text: 'Record income, an expense or a transfer. Amount, date, account and category are the essentials.' },
      { target: ['#btnFilterTx'], title: 'Filter', text: 'Narrow by type, account, category and more. Clear Filters resets it.' },
      { target: ['#btnExportTx'], title: 'Export', text: 'Save the list as a file for a spreadsheet or your accountant.' },
      { target: ['#btnImportTx'], title: 'Import', text: 'Bring in a bank statement file instead of typing each one.' },
      { target: ['.fo-card-wide', '#txSummaryDonut'], title: 'Transaction summary', text: 'Income against expenses for the period you picked, with the net flow in the middle.' },
      { target: ['.tx-source-tab'], title: 'Source tabs', text: 'See everything, only recurring items, or only bills.' },
      { target: ['#txSearchInput'], title: 'Search', text: 'Type part of a description, category or account name.' },
      { target: ['#txFY'], title: 'Financial year', text: 'Show a financial year (1 July to 30 June), handy at tax time.' },
      { target: ['#sortTransactions'], title: 'Sort', text: 'Newest or oldest first, or by amount.' },
      { target: ['.transaction-card'], title: 'Your transactions', text: 'Each one shows category, account and amount. Transfers between your own accounts are marked.' },
      { target: ['.transaction-card .edit-btn', '.edit-btn'], title: 'Edit or delete', text: 'The pencil edits a transaction and the bin removes it.' },
    ],
  },

  'budgets': {
    insight: 'Set a target per category and see what is left. Compare what you planned with what you actually spent.',
    steps: [
      { target: ['#budgetViewMode'], title: 'Budget period', text: 'Budget by week, fortnight, month, quarter or year.' },
      { target: ['#periodPrevBtn', '#periodNextBtn'], title: 'Move between periods', text: 'Step back or forward to see another period.' },
      { target: ['#addBudgetBtn'], title: 'Add a budget', text: 'Set a limit for a category. It tracks what you spend against it.' },
      { target: ['#loadTemplateBtn'], title: 'Starter template', text: 'Load a ready-made set of budgets to start from, then adjust.' },
      { target: ['#saveBudgetTemplateBtn'], title: 'Save as template', text: 'Keep your current budgets as a named template to reuse.' },
      { target: ['#budgetTemplateSelect', '#loadBudgetTemplateBtn'], title: 'Your templates', text: 'Pick a saved template to load it, rename it or delete it.' },
      { target: ['#addDemoTemplatesBtn', '#removeDemoTemplatesBtn'], title: 'Demo templates', text: 'Add or remove the sample templates that come with the demo data.' },
      { target: ['#expandAllBudgetsBtn', '#collapseAllBudgetsBtn'], title: 'Expand or collapse', text: 'Open every budget to see subcategories, or fold them away.' },
      { target: ['.fo-card-wide', '#budgetsSummaryDonut'], title: 'Budget summary', text: 'Budgeted, actual income and spending for the period in one chart.' },
      { target: ['.expense-budget'], title: 'A budget', text: 'Spent against the limit, with a bar and a status such as On Track.' },
      { target: ['.budget-card-row2'], title: 'What is left', text: 'Remaining amount for the category and whether you are on track.' },
      { target: ['.budget-card .edit-btn', '.edit-btn'], title: 'Edit or delete a budget', text: 'Change the limit or remove it with the pencil and bin.' },
      { target: ['#removeAllBudgetsBtn'], title: 'Remove all budgets', text: 'Clears every budget for the period. It asks before doing it.' },
    ],
  },

  'accounts': {
    insight: 'Every bank account, savings account, credit card and wallet in one list, with a health score for how they are tracking.',
    steps: [
      { target: ['#btnNewAcc'], title: 'New account', text: 'Add a bank account, credit card, savings, investment, cash or offset account.' },
      { target: ['#btnTransfer'], title: 'Transfer between accounts', text: 'Move money between your own accounts without counting it as income or spending.' },
      { target: ['#btnAddDefaults'], title: 'Add defaults', text: 'Create a typical set of accounts to start from.' },
      { target: ['#btnRemoveDemoAccounts'], title: 'Remove demo accounts', text: 'Clears the sample accounts when you are ready for real ones.' },
      { target: ['#accountsHealthCard'], title: 'Accounts health', text: 'A score out of 100 for credit use, spread and balances.' },
      { target: ['#accountSearch'], title: 'Search accounts', text: 'Find an account by name.' },
      { target: ['#accountTypeFilter'], title: 'Filter by type', text: 'Show only bank accounts, cards, savings and so on.' },
      { target: ['.account-card-wrap'], title: 'An account card', text: 'Balance, type and last digits. Tap a card to open its details and recent activity.' },
      { target: ['.account-stats'], title: 'Account activity', text: 'How many transactions the account has and when it was last used.', click: '.account-header' },
      { target: ['.account-card-wrap .btn-primary'], title: 'Quick add', text: 'Record a transaction straight into this account.', click: '.account-header' },
      { target: ['.account-card-wrap .btn-secondary'], title: 'Edit or delete', text: 'Rename the account, change its limit, or remove it.', click: '.account-header' },
    ],
  },

  'categories': {
    insight: 'Spending is sorted into parent categories with subcategories. Tidy them here so reports stay meaningful.',
    steps: [
      { target: ['#btnNewCat'], title: 'Add a category', text: 'Create a new main category, or a subcategory under one.' },
      { target: ['#btnResetDefaults'], title: 'Reset to defaults', text: 'Go back to the simplified starter list. It asks first.' },
      { target: ['.fo-card-wide', '#categoriesSummaryDonut'], title: 'Categories summary', text: 'How many categories you have, split into income and expense.' },
      { target: ['#categorySearch'], title: 'Search', text: 'Find a category or subcategory by name.' },
      { target: ['#categoryTypeFilter'], title: 'Filter', text: 'Show only income, only expense, or only main categories.' },
      { target: ['.budget-card'], title: 'A main category', text: 'Shows how many subcategories sit under it.' },
      { target: ['.budget-card .add-btn', '.add-btn'], title: 'Add a subcategory', text: 'The plus adds a subcategory under this category.' },
      { target: ['.budget-card .edit-btn', '.edit-btn'], title: 'Edit or delete', text: 'Rename or remove a category. Transactions keep working either way.' },
      { target: ['.budget-card-row2 .btn'], title: 'Show subcategories', text: 'Open a category to see everything inside it.' },
      { target: ['.subcategory-card'], title: 'A subcategory', text: 'Subcategories can be edited or deleted on their own.', click: '.budget-card-row2 .btn' },
    ],
  },

  'reports': {
    insight: 'Your transactions turned into charts and tables: income against expenses, where the money goes, and how it changes month to month.',
    steps: [
      { target: ['#dateRange'], title: 'Date range', text: 'Pick all time, this year, month or quarter, or choose Custom for your own dates.' },
      { target: ['#startDate'], title: 'Custom dates', text: 'When Custom is chosen, set the start and end dates here.' },
      { target: ['#refreshReports'], title: 'Refresh', text: 'Rebuild the reports after changing the range.' },
      { target: ['#quickStats'], title: 'Quick stats', text: 'Income, expenses, net cash flow, savings rate, average monthly spend and your largest expense.' },
      { target: ['.report-card >> Monthly Income vs Expenses', '#monthlyChart'], title: 'Monthly income vs expenses', text: 'Each month side by side. A month where the bars flip is worth a look.' },
      { target: ['.view-toggle-btn', '#catCostPeriodSelect'], title: 'Expenses by category', text: 'Switch between Categories and Subcategories, and choose the period.' },
      { target: ['.report-card >> Expense Categories', '#expenseChart'], title: 'Expense categories', text: 'Your spending as a share of the total.' },
      { target: ['.report-card >> Top Spending Categories'], title: 'Top spending categories', text: 'The categories you spend the most on, ranked.' },
      { target: ['.report-card >> Spend by Account', '#accountChart'], title: 'Spend by account', text: 'Which accounts the spending came out of.' },
      { target: ['.report-card >> Income Sources', '#incomeChart'], title: 'Income sources', text: 'Where your income came from.' },
      { target: ['.report-card >> Category Breakdown'], title: 'Category breakdown by month', text: 'A table of each category for each month.' },
    ],
  },

  'bills': {
    insight: 'Everything you still have to pay, with due dates. Mark a bill paid when it is settled and it moves out of the way.',
    steps: [
      { target: ['.stat-card.overdue'], title: 'Overdue', text: 'How many bills are past due and the total owing.' },
      { target: ['.stat-card.warning'], title: 'Due this week', text: 'Bills coming up in the next seven days.' },
      { target: ['.stat-card.info'], title: 'Total due', text: 'Everything still to pay, and how many bills that is.' },
      { target: ['#sortBills'], title: 'Sort', text: 'Order bills by due date or by amount.' },
      { target: ['.bills-tab'], title: 'Bill tabs', text: 'Switch between Overdue, Upcoming and Paid.' },
      { target: ['.btn-action.pay'], title: 'Pay', text: 'Mark a bill paid. It creates the expense and moves the bill to Paid.' },
      { target: ['.btn-action.edit'], title: 'Edit', text: 'Change the amount, due date or how often it repeats.' },
      { target: ['.btn-action.delete'], title: 'Delete', text: 'Remove a bill you no longer need.' },
    ],
  },

  'calendar': {
    insight: 'Bills, rent and loan events laid out by date, so you can see which days are heavy before they arrive.',
    steps: [
      { target: ['#prevPeriod', '#nextPeriod'], title: 'Previous and next', text: 'Move to the earlier or later month or week.' },
      { target: ['#todayBtn'], title: 'Today', text: 'Jump back to the current date.' },
      { target: ['.view-toggle-btn'], title: 'Month or week', text: 'Switch between a whole month and a single week.' },
      { target: ['#calendarAccountFilter'], title: 'Filter by account', text: 'Show only the bills and transactions tied to one account.' },
      { target: ['.calendar-stats'], title: 'This month in numbers', text: 'This month\'s bills, upcoming bills and anything overdue.' },
      { target: ['.calendar-table'], title: 'The calendar', text: 'Each day shows income and spending. Tap a day for the detail.' },
      { target: ['.pulse-stat'], title: 'Monthly pulse', text: 'A short summary of busy days, income days and spending days.' },
    ],
  },

  'recurring': {
    insight: 'Templates that create transactions for you on a schedule, like salary and rent. Different from bills, which you still have to pay.',
    steps: [
      { target: ['.stat-card.info'], title: 'Active', text: 'How many recurring items are running and how many are income or expense.' },
      { target: ['.stat-card.positive'], title: 'Net monthly surplus', text: 'Recurring income minus recurring expenses, per month.' },
      { target: ['.stat-card.secondary'], title: 'Monthly total', text: 'The combined monthly size of everything recurring.' },
      { target: ['#filterRecurring'], title: 'Filter', text: 'Show everything, income only, or expenses only.' },
      { target: ['.section-card'], title: 'A recurring item', text: 'Shows what it is, how often it runs and the next date.' },
      { target: ['.btn-action.edit'], title: 'Edit', text: 'Change the amount, schedule or account.' },
      { target: ['.btn-action.delete'], title: 'Delete', text: 'Stop a recurring item. Past transactions stay.' },
    ],
  },

  'subscriptions': {
    insight: 'Streaming, software and other subscriptions in one list, with help spotting the ones you forgot about.',
    steps: [
      { target: ['#detectSubsBtn'], title: 'Detect from transactions', text: 'Scans your transactions for regular charges that look like subscriptions.' },
      { target: ['#addSubscriptionBtn'], title: 'Add a subscription', text: 'Enter one by hand: name, price, how often and when it bills.' },
      { target: ['.stat-card.primary'], title: 'Monthly total', text: 'What all active subscriptions cost per month.' },
      { target: ['.stat-card.info'], title: 'Yearly total', text: 'The same cost projected over a year.' },
      { target: ['.stat-card.success'], title: 'Active', text: 'How many are active out of the total.' },
      { target: ['.stat-card.warning'], title: 'Highest cost', text: 'Your most expensive subscription, worth a second look.' },
      { target: ['.data-table'], title: 'Your subscriptions', text: 'Name, category, billing date, cost and status. Edit or pause from the Actions column.' },
    ],
  },

  'loans': {
    insight: 'Every loan with its repayments, interest paid and payoff progress. Construction loans track each stage as it is drawn.',
    steps: [
      { target: ['#btnNewLoan'], title: 'New loan', text: 'Add a mortgage, vehicle, personal or other loan. Construction loans can have stages.' },
      { target: ['#btnAddDefaultLoans', '#btnRemoveDemoLoans'], title: 'Demo loans', text: 'Add or remove the sample loans that come with the demo data.' },
      { target: ['#btnJumpToWhatIf'], title: 'What-If', text: 'Opens the payoff modeller, where you can test extra repayments on paper.' },
      { target: ['.fo-card-wide', '#loansSummaryDonut'], title: 'Loan summary', text: 'Total balance and how much is paid off across all loans.' },
      { target: ['#sortLoans'], title: 'Sort', text: 'Order loans by balance, interest rate or name.' },
      { target: ['.loan-card-wrap'], title: 'A loan card', text: 'Balance owing, percent paid, the next payment and the interest rate.' },
      { target: ['.payment-btn'], title: 'Make a payment', text: 'Record a repayment. It splits principal and interest for you.' },
      { target: ['.schedule-btn'], title: 'View schedule', text: 'The full repayment schedule for this loan.' },
      { target: ['.transactions-btn'], title: 'View transactions', text: 'Every payment made on this loan so far.' },
      { target: ['.backfill-btn'], title: 'Backfill history', text: 'Creates past payments from the loan start date up to today.' },
      { target: ['.loan-card-actions .edit-btn', '.edit-btn'], title: 'Edit or delete', text: 'Change the loan details or remove it.' },
    ],
  },

  'loans-whatif': {
    insight: 'Test extra repayments, an offset account or a refinance on paper first, and see the time and interest they would save.',
    steps: [
      { target: ['#lwiLoanPicker'], title: 'Pick a loan', text: 'Choose one of your loans to fill in the numbers.' },
      { target: ['#lwiBalance'], title: 'Balance', text: 'The amount still owing.' },
      { target: ['#lwiRate'], title: 'Interest rate', text: 'The yearly rate used for the estimate.' },
      { target: ['#lwiTerm'], title: 'Term', text: 'How long is left on the loan.' },
      { target: ['#lwiExtra'], title: 'Extra repayment', text: 'Add an extra amount per month to see the time and interest you would save.' },
      { target: ['#lwiStartMonth'], title: 'Start month', text: 'When the extra repayments begin.' },
      { target: ['#lwiSummaryCards'], title: 'Results', text: 'Time saved, interest saved and the new payoff date.' },
      { target: ['#lwiChartCanvas'], title: 'Principal vs interest', text: 'The standard plan against the extra-repayment plan.' },
      { target: ['#lwiTableToggle', '#lwiTableBody'], title: 'Amortisation table', text: 'Month-by-month payments. Show All opens the full table.' },
    ],
  },

  'superannuation': {
    insight: 'Follow each super fund: its balance over time, your contributions, and a growth estimate you can adjust.',
    steps: [
      { target: ['#btnNewFund'], title: 'Add a fund', text: 'Add a super fund with member, fund name, number and investment option.' },
      { target: ['.fo-card-wide', '#superSummaryDonut'], title: 'Super summary', text: 'Total balance across all funds.' },
      { target: ['.section-card >> Member #'], title: 'A super fund', text: 'Balance, member and investment option for each fund.' },
      { target: ['.btn-manage-fund'], title: 'Manage a fund', text: 'Open it to log balances, contributions and recurring contributions.' },
      { target: ['.btn-edit-fund', '.btn-delete-fund'], title: 'Edit or delete a fund', text: 'Change the fund details or remove it.' },
    ],
  },

  'insurance': {
    insight: 'Every policy with its premium and renewal date, so renewals never sneak up on you.',
    steps: [
      { target: ['#btnNewPolicy'], title: 'Add a policy', text: 'Record a policy with its provider, premium, renewal date and cover.' },
      { target: ['.tenant-stats'], title: 'Policies and total', text: 'How many policies you have and what they cost in a year.' },
      { target: ['.stat-card.overdue'], title: 'Renewing soon', text: 'Policies renewing within 30 days: the moment to shop around.' },
      { target: ['.tenant-card'], title: 'A policy', text: 'Provider, premium, renewal date and a status such as Overdue or Active.' },
      { target: ['.btn-action'], title: 'Sync from linked item', text: 'Pulls the latest details from the vehicle or property it is linked to.' },
      { target: ['.btn-action.edit', '.btn-action.delete'], title: 'Edit or delete', text: 'Update a policy after renewal, or remove it.' },
    ],
  },

  'vehicles': {
    insight: 'Registration reminders, fuel use and running costs for each vehicle.',
    steps: [
      { target: ['#btnNewVehicle'], title: 'Add a vehicle', text: 'Add a car, trailer or bike with its rego and licence dates.' },
      { target: ['.tenant-stats'], title: 'Vehicles and costs', text: 'How many vehicles you track and what they cost each year.' },
      { target: ['.stat-card.overdue'], title: 'Rego due soon', text: 'Registrations or licences due within 30 days.' },
      { target: ['.tenant-card'], title: 'A vehicle', text: 'Rego status, fuel use and running costs for each one.' },
      { target: ['.btn-action.edit', '.btn-action.delete'], title: 'Edit or delete', text: 'Update details after renewing rego, or remove it.' },
    ],
  },

  'properties': {
    insight: 'Each property with its value, loan, equity, rental yield and cash flow.',
    steps: [
      { target: ['.stats-cards'], title: 'Portfolio summary', text: 'How many properties, their combined value and the monthly rent coming in.' },
      { target: ['.stat-card.warning'], title: 'Monthly mortgage', text: 'What the primary residence costs in repayments each month.' },
      { target: ['#filterPropertyType'], title: 'Filter by type', text: 'Show only primary residences or only investments.' },
      { target: ['#sortProperties'], title: 'Sort', text: 'Order by name, value, type or rent.' },
      { target: ['#filterPropertyFY'], title: 'Financial year', text: 'Choose the year used for rent and expense figures.' },
      { target: ['#btnNewProperty'], title: 'Add a property', text: 'Enter the address, type, purchase price and current value.' },
      { target: ['.property-card'], title: 'A property card', text: 'Value, loan, equity, rental yield and cash flow for each property.' },
      { target: ['.btn-action.maintenance'], title: 'Maintenance', text: 'Jump to repairs logged against this property.' },
      { target: ['.btn-action.tenants'], title: 'Tenants', text: 'Jump to who rents this investment property.' },
      { target: ['.property-card .btn-action.edit', '.btn-action.edit'], title: 'Edit or delete', text: 'Change property details or remove it.' },
    ],
  },

  'tenants': {
    insight: 'Who lives where, what they pay, and when each lease ends.',
    steps: [
      { target: ['#btnNewTenant'], title: 'Add a tenant', text: 'Record a tenant, their lease dates and rent.' },
      { target: ['#rentalIncomeFY'], title: 'Rental income year', text: 'Choose the financial year for rent received.' },
      { target: ['.tenant-stats'], title: 'Tenant totals', text: 'How many tenants, how many are active and the rent per month.' },
      { target: ['.tenant-card.active'], title: 'An active tenant', text: 'Contact details, rent and lease end date.' },
      { target: ['.tenant-card.vacated'], title: 'A past tenant', text: 'Vacated tenants stay on file for your records.' },
      { target: ['.btn-action.edit', '.btn-action.delete'], title: 'Edit or delete', text: 'Update a lease or remove a tenant.' },
    ],
  },

  'maintenance': {
    insight: 'Repairs and upkeep logged against each property. Repairs and improvements are kept apart because tax treats them differently.',
    steps: [
      { target: ['#btnNewMaintenance'], title: 'Add maintenance', text: 'Log a repair or improvement with its cost, priority and status.' },
      { target: ['#maintenanceStats'], title: 'Totals', text: 'Records, total spent, completed jobs and high-priority jobs.' },
      { target: ['#searchMaintenance'], title: 'Search', text: 'Find a job by keyword.' },
      { target: ['#filterStatus'], title: 'Status', text: 'Reported, scheduled, in progress, waiting or completed.' },
      { target: ['#filterCategory'], title: 'Category', text: 'Plumbing, electrical, painting and so on.' },
      { target: ['#filterPriority'], title: 'Priority', text: 'Low, medium, high or emergency.' },
      { target: ['#sortMaintenance'], title: 'Sort', text: 'Newest, oldest or by cost.' },
      { target: ['.maintenance-card'], title: 'A job', text: 'Property, category, cost and due date. The colour shows priority.' },
      { target: ['.maintenance-card-actions .btn-action.edit', '.btn-action.edit'], title: 'Edit or delete', text: 'Update progress or remove a record.' },
    ],
  },

  'expenses': {
    insight: 'Property costs pulled from your transactions and unpaid bills, ready for tax time.',
    steps: [
      { target: ['#btnSyncExpenses'], title: 'Sync from transactions', text: 'Pulls property costs from your transactions into this list.' },
      { target: ['#btnQuickExpense'], title: 'Quick add', text: 'A short form for a fast entry.' },
      { target: ['#btnNewExpense'], title: 'Add expense', text: 'The full form, with category, status and receipt link.' },
      { target: ['#btnExportExpenses'], title: 'Export', text: 'Save the expenses as a file for your accountant.' },
      { target: ['#filterProperty'], title: 'Property', text: 'Show costs for one property or all of them.' },
      { target: ['#filterCategory'], title: 'Category', text: 'Rates, insurance, repairs and so on.' },
      { target: ['#filterPeriod', '#filterDateFrom'], title: 'Period', text: 'This month, quarter, financial year or a custom range.' },
      { target: ['#filterSource', '#filterStatus'], title: 'Source and status', text: 'Where an expense came from, and whether it is paid or reimbursed.' },
      { target: ['#btnApplyFilters', '#btnResetFilters'], title: 'Apply or reset', text: 'Apply the filters, or reset them to see everything.' },
      { target: ['#expensesDashboard'], title: 'Totals', text: 'Total, monthly average, unpaid bills and the tax-deductible amount.' },
    ],
  },

  'tax': {
    insight: 'Rental income, deductions and key dates, built from what you have recorded in the app. A guide and rough estimates, not tax advice.',
    steps: [
      { target: ['#assumedRateInput'], title: 'Assumed tax rate', text: 'The rate used for the indicative tax effect. Change it to match your own.' },
      { target: ['.tax-tab'], title: 'The five tabs', text: 'Overview, Records, Calculators, Reports and Compliance each cover one job.' },
      { target: ['.card >> Tax Deadline Tracker'], title: 'Key dates', text: 'Your next tax dates, worked out from the calendar. Tick the box if you are registered for GST.' },
      { target: ['#rentalSummaryFY', '.card >> Rental Summary'], title: 'Rental summary', text: 'Rent, deductions and net result for the year you pick.' },
      { target: ['#deductionTips', '.card >> Deduction Optimizer'], title: 'Deduction optimizer', text: 'Ideas for deductions you may have missed, and a wizard to check them.' },
      { target: ['#incomeExpenseRecords'], title: 'Income and expenses', text: 'The income and expense records the figures are built from.', click: '.tax-tab:nth-child(2)' },
      { target: ['#loanRecords'], title: 'Loan interest', text: 'Interest paid on loans linked to your properties.', click: '.tax-tab:nth-child(2)' },
      { target: ['#maintenanceRecords'], title: 'Capital works', text: 'Maintenance and improvement records, which can affect depreciation and cost base.', click: '.tax-tab:nth-child(2)' },
      { target: ['.card >> Capital Gains Tax'], title: 'Capital gains tax', text: 'Estimate the tax if you sell, using your purchase and sale dates.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Negative Gearing'], title: 'Negative gearing', text: 'See how a rental loss reduces your tax.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Depreciation Schedule'], title: 'Depreciation', text: 'Estimate yearly deductions for the building and fittings.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> GST Calculator'], title: 'GST calculator', text: 'Add or remove GST from an amount.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Mortgage Calculator (P&I)', '.card >> Mortgage Calculator'], title: 'Mortgage calculators', text: 'Repayments for principal-and-interest and interest-only loans.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Offset Savings'], title: 'Offset savings', text: 'What an offset account could save you in interest.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Rental Yield'], title: 'Rental yield', text: 'Yearly rent as a percentage of the property value.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Property Cash Flow'], title: 'Property cash flow', text: 'Rent minus loan and costs, month by month.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Debt Payoff Order'], title: 'Debt payoff order', text: 'Which debt to pay off first.', click: '.tax-tab:nth-child(3)' },
      { target: ['.card >> Refinance Break-Even'], title: 'Refinance break-even', text: 'How long a refinance takes to pay for itself.', click: '.tax-tab:nth-child(3)' },
      { target: ['#reportFY'], title: 'Report year', text: 'Choose the financial year for the exports.', click: '.tax-tab:nth-child(4)' },
      { target: ['.card >> ATO Report Generator'], title: 'Report generator', text: 'Rental schedule, deduction report and CGT report. Export All saves them together.', click: '.tax-tab:nth-child(4)' },
      { target: ['#complianceChecklist'], title: 'Record checklist', text: 'Checks what is recorded in the app. It does not confirm ATO compliance.', click: '.tax-tab:nth-child(5)' },
      { target: ['#recordKeeping'], title: 'Record keeping', text: 'How long the ATO expects you to keep each kind of record.', click: '.tax-tab:nth-child(5)' },
      { target: ['#riskAssessment'], title: 'Risk assessment', text: 'Things that tend to attract questions, such as rule changes.', click: '.tax-tab:nth-child(5)' },
    ],
  },

  'costbase': {
    insight: 'What each property cost you. When you sell, this is subtracted from the sale price to work out your capital gain.',
    steps: [
      { target: ['#cbPropertyChips'], title: 'Pick a property', text: 'Cost base is tracked one property at a time. Tap a name to open it.' },
      { target: ['.cb-hero', '.cb-card'], title: 'How it adds up', text: 'Purchase price plus buying costs and improvements.' },
      { target: ['.cb-hero-sale'], title: 'If you sold', text: 'Opens your first property. A rough capital gain for a sale price and date you choose.', click: '.cb-card' },
      { target: ['#cbPurchaseDate'], title: 'Purchase contract date', text: 'Enter it to check the 12-month discount properly.', click: '.cb-card' },
      { target: ['#costBaseSuggestions'], title: 'Possible costs', text: 'Transactions that could be part of the cost base. Add the ones that are.' },
      { target: ['#costBaseList'], title: 'Your costs', text: 'Grouped by how they are treated: buying, improvements, selling and deductions.' },
      { target: ['#btnAddRecord', '#btnAddFirstRecord'], title: 'Add a cost', text: 'Choose what the cost is in plain words and it is filed correctly for you.' },
      { target: ['#btnExportReport'], title: 'Export', text: 'Save the ledger as a file for your accountant.' },
    ],
  },

  'settings': {
    insight: 'Currency and exchange rates, backups, App Lock, Family Sync, demo data and this guide all live here.',
    steps: [
      { target: ['[data-open-guide="tour"]'], title: 'Setup guide and tour', text: 'Replay this tour or the setup guide any time.' },
      { target: ['#currencySelect'], title: 'Currency', text: 'Choose your default currency and set exchange rates for others.' },
      { target: ['#newCurrencyCode', '#btnAddCurrency'], title: 'Add a currency', text: 'Add one that is not in the list, then set its rate.' },
      { target: ['#dateFormatSelect'], title: 'Date format', text: 'Australian, US or other date layouts.' },
      { target: ['#displayNameInput', '#savePreferences'], title: 'Your name', text: 'Used for greetings. Save Preferences to keep changes.' },
      { target: ['#themeSelect'], title: 'Theme', text: 'Light, dark or follow your device.' },
      { target: ['#accentColor', '#applyTheme'], title: 'Accent colour', text: 'Pick the highlight colour, then Apply Appearance.' },
      { target: ['#appLockStatus', '#btnEnableLock'], title: 'App Lock', text: 'Protect the app with a PIN. If you forget it, it cannot be recovered.' },
      { target: ['#btnFamilyConnect', '#familySyncStatus'], title: 'Family Sync', text: 'Share data with your family through your own server on your home network.' },
      { target: ['#licenceCard'], title: 'Licence', text: 'Your edition and licence key.' },
      { target: ['#dataStats', '#lastBackupInfo'], title: 'Your data', text: 'How many records you have of each kind, and when you last backed up.' },
      { target: ['#encryptBackupCheckbox'], title: 'Encrypted backup', text: 'Tick this to protect an export with a password.' },
      { target: ['#exportData'], title: 'Export data', text: 'Download a backup file. This is also how you move data between devices.' },
      { target: ['#importFile', '#importData'], title: 'Import data', text: 'Choose a backup file, then Import Data to restore it.' },
      { target: ['#findDuplicatesBtn'], title: 'Find duplicates', text: 'Looks for transactions that were imported twice.' },
      { target: ['#mergeCategoriesBtn', '#cleanOrphansBtn'], title: 'Merge categories', text: 'Combine two categories into one. Also cleans up leftover records.' },
      { target: ['#clearLearnedRulesBtn', '#clearLearnedPropertyRulesBtn'], title: 'Learned rules', text: 'Clear what the app learned about your categories.' },
      { target: ['#loadDemoDataBtn'], title: 'Demo data', text: 'Load sample data to explore with.' },
      { target: ['#checkUpdates', '#clearCache'], title: 'Updates and cache', text: 'Check for a new version, or clear the cached copy if the app looks out of date.' },
      { target: ['#deleteTransactionsBtn', '#clearAllDataBtn'], title: 'Danger zone', text: 'Delete transactions or everything. These cannot be undone, so export first.' },
    ],
  },

  'help': {
    insight: 'Plain-English help for every page, with search.',
    steps: [
      { target: ['#helpSearch'], title: 'Search help', text: 'Type a word to filter every topic.' },
      { target: ['#helpToc'], title: 'Jump to a topic', text: 'Tap a topic to open it.' },
      { target: ['#helpSections'], title: 'The guide', text: 'Backups, importing, currencies and troubleshooting are all covered here.' },
      { target: ['[data-open-guide="tour"]', '.btn.btn-primary'], title: 'Tour and setup', text: 'Replay the tour or the setup guide from the first topic.' },
    ],
  },
};

export function insightFor(view) {
  const entry = PAGE_INSIGHTS[view];
  if (!entry || !entry.insight) return null;
  return { insight: entry.insight, steps: Array.isArray(entry.steps) ? entry.steps : [] };
}
