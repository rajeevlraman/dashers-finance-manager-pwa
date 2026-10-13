// ============================================================================
// ⛽ vehicleFuelStats.js — fuel spend, cost per km and mileage per vehicle
// ============================================================================
//
// Pure functions only (no DB, no DOM) so the maths can be unit tested and
// reused by the Vehicles page. Fuel data comes from Fuel / Petrol
// ('sub_fuel') transactions linked to a vehicle via tx.vehicleId, with three
// optional fields the Transaction form adds for that category:
//
//   tx.fuelLitres    - litres put in
//   tx.fuelOdometer  - odometer (km) at the time of the fill
//   tx.fuelFullTank  - false only when the fill was NOT to full (default true)
//
// Two ways to get mileage (L/100km):
//
//   ACTUAL   - fill-to-fill. Needs litres + odometer on consecutive fills.
//              Litres put in at a full fill = fuel used since the previous
//              full fill, so L/100km = litres / km between the two fills.
//   ESTIMATE - bank data has no litres, so litres are guessed as
//              amount / price-per-litre. The price is learned from this
//              vehicle's own fills that DO have litres, else falls back to
//              the price set on the vehicle. Distance comes from the span
//              between the earliest and latest odometer readings on file.
//
// ACTUAL is preferred whenever it's available; ESTIMATE is only reported
// (and labelled as an estimate by the caller) when there's no actual figure.
// ============================================================================

export const FUEL_CATEGORY_ID = 'sub_fuel';

// A window shorter than this isn't enough distance for cost/km or an
// estimate to mean anything (one short trip's rounding swamps it).
const MIN_KM_FOR_STATS = 50;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Fuel expenses linked to a vehicle, oldest first. */
export function getVehicleFuelTransactions(vehicleId, transactions) {
  return (transactions || [])
    .filter(t =>
      t.vehicleId === vehicleId &&
      t.categoryId === FUEL_CATEGORY_ID &&
      t.type === 'expense' &&
      !t.isTransfer
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Every odometer reading known for a vehicle (its saved history, its
 * current reading, and any odometer typed on a fuel fill), oldest first.
 * Odometers only go up, so a reading lower than an earlier one (a typo) is
 * dropped rather than allowed to produce negative distances.
 */
export function getOdometerReadings(vehicle, fuelTxs) {
  const raw = [];
  (vehicle.odometerHistory || []).forEach(r => raw.push({ date: r.date, km: num(r.km) }));
  if (num(vehicle.odometerReading) > 0 && vehicle.odometerDate) {
    raw.push({ date: vehicle.odometerDate, km: num(vehicle.odometerReading) });
  }
  (fuelTxs || []).forEach(t => {
    if (num(t.fuelOdometer) > 0) raw.push({ date: t.date, km: num(t.fuelOdometer) });
  });

  const valid = raw
    .filter(r => r.date && r.km > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.km - b.km));

  const readings = [];
  for (const r of valid) {
    const last = readings[readings.length - 1];
    if (!last || r.km >= last.km) {
      if (!last || r.date !== last.date || r.km !== last.km) readings.push(r);
    }
  }
  return readings;
}

/**
 * Actual fill-to-fill mileage. Walks fills in order; a "segment" runs from
 * one full fill (with an odometer) to the next, and is only counted when
 * every fill in between has litres recorded. Partial fills (fuelFullTank
 * === false) just add their litres to the running total.
 */
export function computeActualMileage(fuelTxs) {
  let anchor = null;      // last full fill that has an odometer
  let litresAcc = 0;
  let valid = true;
  let totalKm = 0;
  let totalLitres = 0;
  let segments = 0;

  for (const f of fuelTxs) {
    const litres = num(f.fuelLitres);
    const odo = num(f.fuelOdometer);
    const full = f.fuelFullTank !== false;

    if (litres > 0) litresAcc += litres; else valid = false;
    if (!full) continue;

    if (odo <= 0) {
      // A full fill with no odometer can't anchor a segment - start over.
      anchor = null; litresAcc = 0; valid = true;
      continue;
    }
    if (anchor && valid && odo > anchor.odo && litresAcc > 0) {
      totalKm += odo - anchor.odo;
      totalLitres += litresAcc;
      segments++;
    }
    anchor = { odo };
    litresAcc = 0;
    valid = true;
  }

  if (segments === 0 || totalKm <= 0 || totalLitres <= 0) return null;
  return {
    kind: 'actual',
    km: totalKm,
    litres: totalLitres,
    segments,
    lPer100: (totalLitres / totalKm) * 100,
    kmPerL: totalKm / totalLitres
  };
}

/**
 * Price per litre used for estimates: learned from this vehicle's own fills
 * that recorded litres (total $ / total L), else the manual price set on
 * the vehicle, else null.
 */
export function getFuelPricePerLitre(vehicle, fuelTxs) {
  let dollars = 0;
  let litres = 0;
  for (const t of fuelTxs) {
    if (num(t.fuelLitres) > 0) {
      dollars += Math.abs(num(t.amount));
      litres += num(t.fuelLitres);
    }
  }
  if (litres > 0 && dollars > 0) return { price: dollars / litres, source: 'learned' };
  if (num(vehicle.fuelPricePerLitre) > 0) return { price: num(vehicle.fuelPricePerLitre), source: 'set' };
  return null;
}

/**
 * The span the estimate and cost/km are measured over: earliest to latest
 * odometer reading, and the fuel fills paid for in that span. A fill's
 * litres cover the distance driven BEFORE it, so fills on or before the
 * first reading's date belong to earlier driving and are excluded.
 */
function getOdometerWindow(vehicle, fuelTxs) {
  const readings = getOdometerReadings(vehicle, fuelTxs);
  if (readings.length < 2) return null;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const km = last.km - first.km;
  if (km < MIN_KM_FOR_STATS) return null;
  const fills = fuelTxs.filter(t => t.date > first.date && t.date <= last.date);
  if (fills.length === 0) return null;
  return { km, fills, from: first.date, to: last.date };
}

export function computeEstimatedMileage(vehicle, fuelTxs) {
  const win = getOdometerWindow(vehicle, fuelTxs);
  if (!win) return null;
  const priceInfo = getFuelPricePerLitre(vehicle, fuelTxs);

  let litres = 0;
  let estimatedFills = 0;
  for (const f of win.fills) {
    if (num(f.fuelLitres) > 0) {
      litres += num(f.fuelLitres);
    } else if (priceInfo) {
      litres += Math.abs(num(f.amount)) / priceInfo.price;
      estimatedFills++;
    } else {
      return null; // a fill with no litres and no price to guess from
    }
  }
  if (litres <= 0) return null;
  return {
    kind: 'estimate',
    km: win.km,
    litres,
    lPer100: (litres / win.km) * 100,
    kmPerL: win.km / litres,
    price: priceInfo ? priceInfo.price : null,
    priceSource: priceInfo ? priceInfo.source : null,
    estimatedFills
  };
}

export function computeCostPerKm(vehicle, fuelTxs) {
  const win = getOdometerWindow(vehicle, fuelTxs);
  if (!win) return null;
  const spend = win.fills.reduce((s, f) => s + Math.abs(num(f.amount)), 0);
  if (spend <= 0) return null;
  return { value: spend / win.km, km: win.km, spend };
}

/** Everything the Vehicles page card needs for one vehicle. */
export function computeVehicleFuelStats(vehicle, transactions, now = new Date()) {
  const fuelTxs = getVehicleFuelTransactions(vehicle.id, transactions);
  if (fuelTxs.length === 0) return null;

  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAgoStr = yearAgo.toISOString().slice(0, 10);
  const monthPrefix = now.toISOString().slice(0, 7);

  const last12 = fuelTxs.filter(t => t.date >= yearAgoStr);
  const spend12m = last12.reduce((s, t) => s + Math.abs(num(t.amount)), 0);
  const spendThisMonth = fuelTxs
    .filter(t => (t.date || '').startsWith(monthPrefix))
    .reduce((s, t) => s + Math.abs(num(t.amount)), 0);

  const mileage = computeActualMileage(fuelTxs) || computeEstimatedMileage(vehicle, fuelTxs);

  return {
    fillCount: fuelTxs.length,
    fills12m: last12.length,
    spend12m,
    spendThisMonth,
    avgFill12m: last12.length ? spend12m / last12.length : 0,
    costPerKm: computeCostPerKm(vehicle, fuelTxs),
    mileage
  };
}

/**
 * Adds a reading to an odometer history array without duplicating an entry
 * that's already there. Returns a new array.
 */
export function addOdometerReading(history, km, date) {
  const list = Array.isArray(history) ? [...history] : [];
  const k = num(km);
  if (k > 0 && date && !list.some(h => h.date === date && num(h.km) === k)) {
    list.push({ date, km: k });
  }
  return list;
}

// ============================================================================
// 🧠 Learning which vehicle a fuel purchase belongs to
// ============================================================================
//
// There's no separate "rules" store to keep in sync: every fuel transaction
// the person has already linked to a vehicle IS a training example, so the
// suggestion is worked out from those at the time it's needed. Edit or
// delete a link and the "learning" follows automatically.
//
// Three signals, strongest first:
//   ACCOUNT   (3 pts) - this account/card has, almost always (90%+, at
//                       least 2 fills), paid for just one vehicle.
//   FILL SIZE (1 pt)  - the amount is close to (within 25% of) one vehicle's
//                       typical fill and NOT close to any other's. Only
//                       counts once a vehicle has 3+ fills to judge by. An
//                       SUV's tank takes noticeably bigger fills than a car.
//   SERVO     (1 pt)  - the same merchant has almost always been that
//                       vehicle. Weak on its own: both vehicles often use
//                       the same servo.
//
// "Confident" means the account signal points at one vehicle and nothing
// disagrees. Anything less still gets suggested, but with a warning so the
// Review tool leaves it unticked. Ties are skipped (no information).
// ============================================================================

const LEARN_MIN_ACCOUNT_EXAMPLES = 2;
const LEARN_MIN_SIZE_EXAMPLES = 3;
const LEARN_SIZE_TOLERANCE = 0.25;
const LEARN_MIN_SHARE = 0.9;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fuelMerchantKey(tx) {
  return String(tx.merchant || tx.cleanDescription || tx.description || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Which vehicle got most of a list of linked fills, and what share it got.
function topVehicleShare(examples) {
  const counts = new Map();
  for (const e of examples) counts.set(e.vehicleId, (counts.get(e.vehicleId) || 0) + 1);
  let bestId = null;
  let bestCount = 0;
  for (const [id, c] of counts) {
    if (c > bestCount) { bestId = id; bestCount = c; }
  }
  return { id: bestId, share: examples.length ? bestCount / examples.length : 0, n: examples.length };
}

const vehicleLabel = (v) => v.nickname || v.rego || 'another vehicle';

/**
 * Suggests which vehicle an (as yet unlinked) fuel transaction belongs to.
 * `tx` needs accountId, amount and ideally merchant/description.
 * Returns { vehicle, points, reasons, confident, warning } or null.
 */
export function suggestVehicleForFuel(tx, transactions, vehicles) {
  if (!vehicles || vehicles.length === 0) return null;
  if (vehicles.length === 1) {
    return { vehicle: vehicles[0], points: 99, reasons: ['only vehicle'], confident: true, warning: null };
  }

  const vehicleIds = new Set(vehicles.map(v => v.id));
  const examples = (transactions || []).filter(t =>
    t.categoryId === FUEL_CATEGORY_ID &&
    t.type === 'expense' &&
    !t.isTransfer &&
    t.vehicleId && vehicleIds.has(t.vehicleId) &&
    t.id !== tx.id
  );
  if (examples.length === 0) return null;

  const points = new Map(vehicles.map(v => [v.id, 0]));
  const reasons = new Map(vehicles.map(v => [v.id, []]));
  const add = (id, pts, reason) => {
    if (!points.has(id)) return;
    points.set(id, points.get(id) + pts);
    reasons.get(id).push(reason);
  };

  if (tx.accountId) {
    const sameAccount = examples.filter(e => e.accountId === tx.accountId);
    const top = topVehicleShare(sameAccount);
    if (top.n >= LEARN_MIN_ACCOUNT_EXAMPLES && top.share >= LEARN_MIN_SHARE) add(top.id, 3, 'account');
  }

  const merchant = fuelMerchantKey(tx);
  if (merchant) {
    const sameMerchant = examples.filter(e => fuelMerchantKey(e) === merchant);
    const top = topVehicleShare(sameMerchant);
    if (top.n >= LEARN_MIN_ACCOUNT_EXAMPLES && top.share >= LEARN_MIN_SHARE) add(top.id, 1, 'servo');
  }

  const amount = Math.abs(num(tx.amount));
  if (amount > 0) {
    const fitting = [];
    for (const v of vehicles) {
      const fills = examples.filter(e => e.vehicleId === v.id).map(e => Math.abs(num(e.amount)));
      if (fills.length < LEARN_MIN_SIZE_EXAMPLES) continue;
      const typical = median(fills);
      if (typical > 0 && Math.abs(amount - typical) <= typical * LEARN_SIZE_TOLERANCE) fitting.push(v.id);
    }
    if (fitting.length === 1) add(fitting[0], 1, 'fill size');
  }

  const ranked = vehicles
    .map(v => ({ vehicle: v, points: points.get(v.id), reasons: reasons.get(v.id) }))
    .sort((a, b) => b.points - a.points);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best.points === 0) return null;
  if (runnerUp && runnerUp.points === best.points) return null; // no information to separate them

  let warning = null;
  if (runnerUp && runnerUp.points > 0) {
    warning = `Signals disagree — could also be "${vehicleLabel(runnerUp.vehicle)}" — check before applying`;
  } else if (best.points < 3) {
    warning = `Matched by ${best.reasons.join(' + ')} only — check before applying`;
  }
  return {
    vehicle: best.vehicle,
    points: best.points,
    reasons: best.reasons,
    confident: warning === null,
    warning
  };
}
