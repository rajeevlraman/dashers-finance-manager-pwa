import { formatMoney, toBase } from './utils/currency.js';
// billReminders.js
//
// Two complementary reminder mechanisms, since a static client-side app
// with no backend can't do true "closed app" push notifications:
//
// 1. Browser notifications — fire while the app is open (checked once per
//    load, right after the existing bill auto-pay check). Reliable only
//    while you actually have the app open in a tab; the browser does not
//    wake it up in the background to check on a schedule.
//
// 2. Calendar export (.ics) — generates a real calendar file with alarms
//    that you import into your phone/Google/Outlook calendar once. These
//    fire natively regardless of whether the app is open, which is the
//    only fully reliable reminder path available here. Recommended for
//    anything you actually don't want to miss (insurance direct debits,
//    loan repayments).

const NOTIFIED_LOG_KEY = 'dfm_bill_notified_log';
const DUE_SOON_WINDOW_DAYS = 3;

export function getNotificationPermissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

export async function requestBillNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (err) {
    console.warn('[billReminders] Permission request failed', err);
    return 'denied';
  }
}

function loadNotifiedLog() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_LOG_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveNotifiedLog(log) {
  try {
    localStorage.setItem(NOTIFIED_LOG_KEY, JSON.stringify(log));
  } catch {
    // localStorage unavailable — notifications just won't be deduped, not fatal
  }
}

// Checks unpaid bills for anything overdue or due within the next few days
// and fires a browser notification summarizing them — but only once per
// calendar day per bill, so reopening the app repeatedly doesn't spam you.
// Call this once per app load, after processDueBills() has already
// auto-paid anything it could.
export function checkAndNotifyDueBills(bills, today = new Date().toISOString().slice(0, 10)) {
  if (getNotificationPermissionState() !== 'granted') return { notified: 0 };

  const soonCutoff = new Date(today);
  soonCutoff.setDate(soonCutoff.getDate() + DUE_SOON_WINDOW_DAYS);
  const soonCutoffStr = soonCutoff.toISOString().slice(0, 10);

  const relevant = bills.filter(b => !b.paid && b.dueDate <= soonCutoffStr);
  if (relevant.length === 0) return { notified: 0 };

  const log = loadNotifiedLog();
  const alreadyNotifiedToday = log[today] || [];
  const toNotify = relevant.filter(b => !alreadyNotifiedToday.includes(b.id));
  if (toNotify.length === 0) return { notified: 0 };

  const overdue = toNotify.filter(b => b.dueDate < today);
  const dueSoon = toNotify.filter(b => b.dueDate >= today);

  const titleParts = [];
  if (overdue.length) titleParts.push(`${overdue.length} overdue`);
  if (dueSoon.length) titleParts.push(`${dueSoon.length} due soon`);

  const body = toNotify
    .slice(0, 5)
    .map(b => `${b.name} — ${formatMoney(Number(b.amount), b.currency)} (${b.dueDate})`)
    .join('\n') + (toNotify.length > 5 ? `\n…and ${toNotify.length - 5} more` : '');

  try {
    new Notification(`Bills: ${titleParts.join(', ')}`, {
      body,
      icon: 'assets/icons/icon-192.png',
      tag: 'dfm-bill-reminder' // replaces any previous reminder notification instead of stacking
    });
  } catch (err) {
    console.warn('[billReminders] Failed to show notification', err);
    return { notified: 0 };
  }

  log[today] = [...alreadyNotifiedToday, ...toNotify.map(b => b.id)];
  // Keep the log from growing forever — only keep the last 14 days.
  const cutoffKeep = new Date(today);
  cutoffKeep.setDate(cutoffKeep.getDate() - 14);
  const cutoffKeepStr = cutoffKeep.toISOString().slice(0, 10);
  for (const dateKey of Object.keys(log)) {
    if (dateKey < cutoffKeepStr) delete log[dateKey];
  }
  saveNotifiedLog(log);

  return { notified: toNotify.length };
}

// ---------------------------------------------------------------------------
// Calendar export (.ics)
// ---------------------------------------------------------------------------

function icsEscape(str = '') {
  return String(str).replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

function toICSDate(dateStr) {
  // All-day event date format: YYYYMMDD
  return dateStr.replace(/-/g, '');
}

// Exports every currently-unpaid bill as a one-off all-day calendar event
// with a same-day alarm, plus a second alarm 2 days ahead for anything
// $200+ (insurance premiums, loan repayments etc. — the ones worth a
// heads-up before the money actually moves). One-off events (not a
// repeating RRULE) are used deliberately: the app already generates the
// *next* instance of a recurring bill only after the current one is paid,
// so exporting exactly what's in the database right now always matches
// reality, rather than trying to independently predict a recurrence
// pattern that could drift out of sync.
export function exportBillsToICS(bills, properties = []) {
  const unpaid = bills.filter(b => !b.paid);
  if (unpaid.length === 0) {
    alert('No unpaid bills to export.');
    return;
  }

  const propertyById = new Map(properties.map(p => [p.id, p]));
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const events = unpaid.map(bill => {
    const property = propertyById.get(bill.propertyId);
    const summary = `💰 ${bill.name} due — ${formatMoney(Number(bill.amount), bill.currency)}`;
    const descriptionParts = [`Amount: ${formatMoney(Number(bill.amount), bill.currency)}`];
    if (bill.recurring) descriptionParts.push(`Recurring: ${bill.recurring}`);
    if (property) descriptionParts.push(`Property: ${property.name}`);
    const description = descriptionParts.join('\\n');

    const isHighValue = toBase(Number(bill.amount), bill.currency) >= 200;
    const dtstart = toICSDate(bill.dueDate);

    return [
      'BEGIN:VEVENT',
      `UID:${bill.id}@dashers-finance-manager`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dtstart}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Bill due today',
      'TRIGGER:PT9H', // 9am on the due date (relative to the all-day start)
      'END:VALARM',
      ...(isHighValue ? [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Bill due in 2 days',
        'TRIGGER:-P2DT15H', // 2 days before, 9am
        'END:VALARM'
      ] : []),
      'END:VEVENT'
    ].join('\r\n');
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dashers Finance Manager//Bill Reminders//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dashers-bill-reminders.ics';
  a.click();
  URL.revokeObjectURL(url);
}
