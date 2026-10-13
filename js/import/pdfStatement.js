// ============================================================================
// 📄 pdfStatement.js — read a bank statement PDF (Date | Particulars |
// Withdrawals | Deposits | Balance style) into plain transaction rows.
// ----------------------------------------------------------------------------
// Bank PDFs are laid out as columns, and multi-line cells (a wrapped
// "Particulars") are often vertically offset from the date/amount cells, so
// reading line-by-line breaks. Instead:
//   1. every amount in the Withdrawals/Deposits columns is an "anchor" — one
//      per transaction,
//   2. the page is split into a band per anchor (midpoints between anchors),
//   3. the date, particulars lines and balance inside a band belong to it.
// The sign comes from the running balance when it is available (delta vs the
// previous balance), falling back to which column the amount sits in. Rows
// whose balance arithmetic doesn't add up are flagged, never silently kept.
// ============================================================================

const AMOUNT_RE = /^\(?-?[\d,]+\.\d{2}\)?(\s*(cr|dr)\.?)?$/i;
const DATE_RE = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}[\s\-][A-Za-z]{3,9}[\s\-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseAmountToken(raw) {
  let s = String(raw).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/dr\.?\s*$/i.test(s)) neg = true;
  s = s.replace(/\s*(cr|dr)\.?\s*$/i, '').replace(/[,\s]/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

export function toIsoDate(raw) {
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/); // day first
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-](\d{2,4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${String(MONTHS[m[2].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const cx = it => it.x + it.w / 2;
const right = it => it.x + it.w;

// Merge pdf.js text fragments that sit on the same line and touch each other
// (some PDFs emit one item per glyph run) into single items.
function mergeFragments(items) {
  // pdf.js emits blank "space" items with unreliable widths; they only cause
  // false merges, so drop them and merge just glyph runs that actually touch.
  const real = items.filter(i => i.str.trim() !== '' );
  const sorted = [...real].sort((a, b) => (Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y));
  const out = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? it.x - right(prev) : Infinity;
    if (prev && Math.abs(prev.y - it.y) < 2 && gap < 1.5 && gap > -2) {
      prev.str += it.str;
      prev.w = right(it) - prev.x;
    } else {
      out.push({ ...it, str: it.str.trim() });
    }
  }
  return out;
}

function findHeader(items) {
  const rowsByY = [];
  for (const it of items) {
    let row = rowsByY.find(r => Math.abs(r.y - it.y) < 3);
    if (!row) { row = { y: it.y, items: [] }; rowsByY.push(row); }
    row.items.push(it);
  }
  for (const row of rowsByY.sort((a, b) => a.y - b.y)) {
    const find = re => row.items.find(i => re.test(i.str.trim()));
    const date = find(/^date$/i);
    const part = find(/^(particulars|description|narration|details|transaction details)$/i);
    const wd = find(/^(withdrawals?|debits?|paid out|money out)$/i);
    const dep = find(/^(deposits?|credits?|paid in|money in)$/i);
    const bal = find(/^balance$/i);
    if (date && part && bal && (wd || dep)) {
      return { y: row.y, date, part, wd, dep, bal };
    }
  }
  return null;
}

// Assign a numeric item to the nearest of the header columns.
function nearestColumn(it, cols) {
  let best = null;
  let bestD = Infinity;
  for (const [name, h] of cols) {
    const d = Math.min(Math.abs(cx(it) - cx(h)), Math.abs(right(it) - right(h)));
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

/**
 * pages: [{ items: [{ str, x, y, w }] }]  (y grows downward)
 * Returns { rows, openingBalance, warnings, checked, mismatched }
 */
export function layoutToRows(pages) {
  const rows = [];
  const warnings = [];
  const emptyPages = [];
  let header = null;
  let openingBalance = null;
  let prevBalance = null;

  pages.forEach((page, pageIndex) => {
    const items = mergeFragments(page.items.filter(i => i.str.trim() !== ''));
    // A page with no text layer at all is a scanned/flattened image (e.g. a redacted export): nothing on
    // it can be read, so its transactions are MISSING — say so plainly instead of "no headers found".
    if (items.length === 0) {
      emptyPages.push(pageIndex + 1);
      warnings.push(`Page ${pageIndex + 1} has no readable text (it looks like a scanned image), so any transactions on it are not included.`);
      return;
    }
    const h = findHeader(items) || header;
    if (!h) { warnings.push(`Page ${pageIndex + 1}: no column headers found, skipped`); return; }
    header = h;

    const cols = [['bal', h.bal]];
    if (h.wd) cols.push(['wd', h.wd]);
    if (h.dep) cols.push(['dep', h.dep]);

    const body = items.filter(i => i.y > h.y + 2);
    const numericStart = Math.min(...cols.map(([, c]) => c.x)) - 40;

    const numerics = body.filter(i => AMOUNT_RE.test(i.str.trim()) && i.x >= numericStart)
      .map(i => ({ ...i, col: nearestColumn(i, cols) }));

    // Opening balance: a balance-column number on the same line as an
    // "Opening Balance" label (or before any transaction).
    const openLabel = body.find(i => /opening\s+balance|balance\s+b\/?f|brought\s+forward/i.test(i.str));
    const closeLabel = body.filter(i => /closing\s+balance|balance\s+c\/?f|carried\s+forward|^total/i.test(i.str));
    const usedAsLabel = new Set();
    if (openLabel) {
      const b = numerics.find(n => n.col === 'bal' && Math.abs(n.y - openLabel.y) < 5);
      if (b) {
        usedAsLabel.add(b);
        if (openingBalance === null) openingBalance = parseAmountToken(b.str);
      }
    }
    for (const cl of closeLabel) {
      numerics.filter(n => Math.abs(n.y - cl.y) < 5).forEach(n => usedAsLabel.add(n));
    }

    const anchors = numerics
      .filter(n => (n.col === 'wd' || n.col === 'dep') && !usedAsLabel.has(n))
      .sort((a, b) => a.y - b.y);
    if (!anchors.length) return;

    const gaps = anchors.slice(1).map((a, i) => a.y - anchors[i].y).sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 36;
    const top = h.y + 2;
    // Canara-style layouts end every transaction with a "Chq: <ref>" line. When there is exactly
    // one per transaction, use it as the block terminator so a block's last line can't drift into
    // the next transaction's band. Otherwise fall back to midpoint bands.
    const chqLines = body.filter(i => /^chq\s*:/i.test(i.str.trim())).sort((a, b) => a.y - b.y);
    const chqTerminated = chqLines.length === anchors.length &&
      chqLines.every((c, i) => c.y >= anchors[i].y - 2 && (i === 0 || c.y > anchors[i - 1].y));
    const bandTop = i => (chqTerminated ? (i === 0 ? top : chqLines[i - 1].y + 1)
      : (i === 0 ? top : (anchors[i - 1].y + anchors[i].y) / 2));
    const bandBottom = i => (chqTerminated ? chqLines[i].y + 1
      : (i === anchors.length - 1
        ? anchors[i].y + Math.max(medianGap * 1.5, 24)
        : (anchors[i].y + anchors[i + 1].y) / 2));

    anchors.forEach((a, i) => {
      const t = bandTop(i), b = bandBottom(i);
      const inBand = it => it.y >= t && it.y < b;
      // Headers are often centred over their column, so cell text can start
      // LEFT of the header's x. Bound the description by the date column on
      // the left and the first amount column on the right instead.
      const amountLeft = Math.min(...cols.filter(([n]) => n !== 'bal').map(([, c]) => c.x),
                                  ...anchors.map(n => n.x)) - 2;
      const dateCandidates = body.filter(it => inBand(it) && DATE_RE.test(it.str.trim()) && cx(it) < cx(h.part));
      const dateItem = dateCandidates.sort((p, q) => p.y - q.y)[0];
      const balItem = numerics.find(n => n.col === 'bal' && inBand(n) && !usedAsLabel.has(n));
      const dateRight = Math.max(right(h.date), ...dateCandidates.map(right)) + 1;
      const isNoise = it => usedAsLabel.has(it) || (openLabel && it === openLabel) || closeLabel.includes(it);
      const descItems = body.filter(it =>
        inBand(it) && it.x >= dateRight && it.x < amountLeft &&
        !DATE_RE.test(it.str.trim()) && !AMOUNT_RE.test(it.str.trim()) && !isNoise(it)
      ).sort((p, q) => (Math.abs(p.y - q.y) < 3 ? p.x - q.x : p.y - q.y));

      rows.push({
        page: pageIndex + 1,
        dateRaw: dateItem ? dateItem.str.trim() : null,
        description: descItems.map(d => d.str.trim()).join(' ').replace(/\s+/g, ' ').trim(),
        amountAbs: Math.abs(parseAmountToken(a.str)),
        column: a.col,
        balance: balItem ? parseAmountToken(balItem.str) : null
      });
    });
  });

  // Carry dates forward when a bank omits a repeated date, then resolve signs.
  let lastDate = null;
  let checked = 0, mismatched = 0;
  prevBalance = openingBalance;
  const out = [];
  for (const r of rows) {
    if (r.dateRaw) lastDate = toIsoDate(r.dateRaw);
    const date = lastDate;
    let amount = r.column === 'dep' ? r.amountAbs : -r.amountAbs; // column-based default
    let flagged = false;

    if (r.balance !== null && prevBalance !== null) {
      const delta = Math.round((r.balance - prevBalance) * 100) / 100;
      checked++;
      if (Math.abs(Math.abs(delta) - r.amountAbs) < 0.011) {
        amount = delta > 0 ? r.amountAbs : -r.amountAbs;   // balance arithmetic wins
      } else {
        mismatched++;
        flagged = true;
        warnings.push(`${r.dateRaw || 'row'} "${r.description.slice(0, 40)}": amount ${r.amountAbs} doesn't match balance change ${delta}`);
      }
    }
    if (r.balance !== null) prevBalance = r.balance;
    else if (prevBalance !== null) prevBalance = Math.round((prevBalance + amount) * 100) / 100; // keep the chain going

    if (!date) { warnings.push(`Row "${r.description.slice(0, 40)}" has no date, skipped`); continue; }
    out.push({ date, description: r.description, amount, balance: r.balance, flagged, page: r.page });
  }
  // Statements normally open with an opening balance (or the first row's balance chains from one). When
  // an unreadable page came first, the opening balance and the rows on it are gone — make that explicit.
  if (out.length && openingBalance === null && emptyPages.length) {
    warnings.push("No opening balance was found, so the first transaction can't be cross-checked against a previous balance.");
  }
  // Whole-statement check (only possible with an opening balance and a closing balance on the last row).
  const last = out[out.length - 1];
  if (out.length && openingBalance !== null && last?.balance !== null && last?.balance !== undefined && !mismatched) {
    const expected = Math.round((openingBalance + out.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
    if (Math.abs(expected - last.balance) > 0.011) {
      warnings.push(`Opening balance + these transactions = ${expected.toFixed(2)}, but the statement's last balance is ${last.balance.toFixed(2)} — some rows may be missing.`);
    }
  }
  return {
    rows: out, openingBalance, warnings, checked, mismatched, emptyPages,
    statementCurrency: detectStatementCurrency(pages),
    pageCount: pages.length
  };
}

// Best-effort guess at the statement's currency from its text, so importing it into an account of a
// different currency can be caught before ₹ amounts are saved as dollars. Only returns a value when the
// evidence is clear; null means "can't tell" (which never blocks an import).
//  - an explicit INR / ₹ / Rs marker, or
//  - Indian digit grouping (10,44,629.65 / 2,00,000.00 — lakh/crore), which Western formats never produce.
export function detectStatementCurrency(pages) {
  const text = (pages || []).map(p => (p.items || []).map(i => i.str).join(' ')).join(' ');
  if (/₹|\bINR\b|\bRs\.?\s?\d/.test(text)) return 'INR';
  const lakh = text.match(/\b\d{1,2}(?:,\d{2})+,\d{3}\.\d{2}\b/g) || [];
  return lakh.length >= 2 ? 'INR' : null;
}

// A bank's own transaction reference ("Chq: 500132195648", UPI ref numbers): unique per transaction, so it
// is a far better duplicate key than date+amount+description. "0"/blank are placeholders, not references.
export function extractBankReference(desc) {
  const m = /\bChq\s*:\s*(\d+)\s*$/i.exec(String(desc || '').trim());
  return m && !/^0+$/.test(m[1]) ? m[1] : null;
}

// Shorten bank noise for display while the parser keeps the original as raw.
export function tidyDescription(desc) {
  let d = String(desc || '').replace(/\s+/g, ' ').trim();
  d = d.replace(/\s*Chq:\s*\d+\s*$/i, '');
  const upi = d.match(/^UPI\/(?:DR|CR)\/\d+\/([^\/]+)\//i);
  if (upi) return `UPI - ${upi[1].trim()}`;
  return d;
}

let pdfjsPromise = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

// Extract positioned text from a PDF. `source` is a File/Blob or Uint8Array.
export async function extractPages(source, pdfjs) {
  const lib = pdfjs || await loadPdfJs();
  const data = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  const doc = await lib.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      items: content.items
        .filter(i => typeof i.str === 'string')
        .map(i => ({ str: i.str, x: i.transform[4], y: viewport.height - i.transform[5], w: i.width }))
    });
  }
  return pages;
}

export async function parsePdfStatement(source, pdfjs) {
  const pages = await extractPages(source, pdfjs);
  const result = layoutToRows(pages);
  if (!result.rows.length) {
    throw new Error('No transactions found in this PDF. It may be a scanned image (no text) or an unsupported layout.');
  }
  return result;
}
