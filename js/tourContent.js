// tourContent.js
//
// What the "tour" shows: every page in the app, grouped like the menu, each
// with one plain-English line. The groups and labels come straight from
// navItems.js (so a page added to the menu appears here automatically); only
// the one-line descriptions live in this file. A test checks none are missing.

import { NAV_ITEMS } from './navItems.js';

export const TOUR_BLURBS = {
  'financial-dashboard': 'Charts for income and spending trends, category breakdowns, budget versus actual, and savings goals.',
  'wealth-overview': 'Your net worth across accounts, property, loans and super, in one view.',
  'finance-overview': 'Your everyday home screen: net worth, debt, cash runway and what bills are coming up.',
  'transactions': 'Every transaction in one place. Search, filter, export, and import bank statements.',
  'budgets': 'Set a limit per category and see what is left this month. Save templates to reuse.',
  'accounts': 'Bank accounts, savings, credit cards and cash, with an accounts health score.',
  'categories': 'Organise spending into categories and subcategories, and tidy up duplicates.',
  'reports': 'Income against expenses, spending by category, savings rate and more.',
  'bills': 'What you still have to pay, with due dates, linked accounts and reminders.',
  'calendar': 'Bills, rent and loan events on a calendar. Export dates to your phone.',
  'recurring': 'Templates that create transactions on a schedule, such as salary and rent.',
  'subscriptions': 'Streaming, software and other subscriptions, with help spotting forgotten ones.',
  'loans': 'Repayment schedules, interest paid and payoff progress for every loan.',
  'loans-whatif': 'Try extra repayments, an offset account or a refinance before you commit.',
  'superannuation': 'Follow each super fund and its balance over time.',
  'insurance': 'Policies, premiums and renewal dates, with reminders before they are due.',
  'vehicles': 'Registration reminders, fuel use and running costs for each vehicle.',
  'properties': 'Each property with its value, loan, equity, rental yield and cash flow.',
  'tenants': 'Who lives where, what they pay, and lease dates.',
  'maintenance': 'Repairs and upkeep logged against each property.',
  'expenses': 'Property costs, ready for tax time.',
  'tax': 'Reports for your tax return, based on your property income and expenses.',
  'costbase': 'Track the cost base for capital gains, including the 12-month discount.',
  'settings': 'Currency and exchange rates, backups, App Lock, Family Sync, demo data and this guide.',
  'help': 'Plain-English help for every page, with search.',
};

export const GROUP_ORDER = ['Dashboard', 'Money', 'Bills & Recurring', 'Loans & Assets', 'Property', 'Tax', 'More'];

// isLocked(view) -> true when the person's edition does not include the page.
// editionOf(view) -> the edition name to show next to a locked page.
export function tourGroups({ isLocked = () => false, editionOf = () => '' } = {}) {
  const groups = [];
  for (const name of GROUP_ORDER) {
    const items = NAV_ITEMS.filter(i => i.group === name).map(i => ({
      view: i.view, icon: i.icon, label: i.label,
      blurb: TOUR_BLURBS[i.view] || '',
      locked: !!isLocked(i.view),
      edition: isLocked(i.view) ? editionOf(i.view) : '',
    }));
    if (items.length) groups.push({ name, items });
  }
  // Any group a future page adds that is not listed above still shows up.
  for (const i of NAV_ITEMS) {
    if (!GROUP_ORDER.includes(i.group) && !groups.some(g => g.name === i.group)) {
      groups.push({ name: i.group, items: NAV_ITEMS.filter(x => x.group === i.group).map(x => ({
        view: x.view, icon: x.icon, label: x.label, blurb: TOUR_BLURBS[x.view] || '',
        locked: !!isLocked(x.view), edition: isLocked(x.view) ? editionOf(x.view) : '' })) });
    }
  }
  return groups;
}
