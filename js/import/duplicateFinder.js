// ============================================================================
// 🔎 import/duplicateFinder.js — Find likely-duplicate transactions already
// sitting in the database (e.g. left over from a CSV import + backup
// restore of overlapping data, from before the restore dedup fix existed).
// ============================================================================
//
// Reuses the exact same content-based comparison saveImportedTransactions()
// and backup restore both already use — same account, same amount, same
// description, date within +/- 2 days — so "duplicate" means the same
// thing everywhere in the app, not three slightly different definitions.

import { isDuplicateTransaction } from './saver.js';

import { isUncategorised } from '../recurringMatch.js';
// ---------------------------------------------------------------------------
// Groups transactions into clusters of mutual duplicates.
//
// This is a union-find (disjoint set) over pairwise isDuplicateTransaction
// checks rather than a stricter transitive/global rule, because bank
// posting-date drift means the pairwise check is not perfectly transitive
// (A and B within 2 days, B and C within 2 days, but A and C 4 days apart
// is possible) — clustering anything pairwise-connected together is the
// right behavior for a review tool: better to group a borderline case for
// a human to look at than to silently miss it by demanding a stricter
// global match.
//
// Returns only groups with 2+ members (i.e. actual duplicate sets), each
// sorted oldest-created-first so index 0 is a sensible default "keep".
// Groups themselves are sorted by date, most recent first.
// ---------------------------------------------------------------------------
export function findDuplicateGroups(transactions) {
  const n = transactions.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path compression
      i = parent[i];
    }
    return i;
  }

  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // isDuplicateTransaction takes (candidate, existingList) — passing a
      // single-item list here reuses the exact same pairwise rule as
      // import/restore without duplicating the comparison logic.
      if (isDuplicateTransaction(transactions[i], [transactions[j]])) {
        union(i, j);
      }
    }
  }

  const clusters = new Map(); // root index -> array of transactions
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(transactions[i]);
  }

  const groups = Array.from(clusters.values()).filter(g => g.length > 1);

  // Index 0 is the default "keep". Prefer the most informative copy (user
  // categorised > has a description), then the oldest-created. So an older
  // blank import loses to a newer copy that carries the bank's details.
  const score = t => (!isUncategorised(t.categoryId) ? 2 : 0) + ((t.description || '').trim() ? 1 : 0);
  for (const group of groups) {
    group.sort((a, b) => score(b) - score(a) ||
      new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date));
  }
  groups.sort((a, b) => new Date(b[0].date) - new Date(a[0].date));

  return groups;
}

// ---------------------------------------------------------------------------
// Given the groups from findDuplicateGroups(), returns the ids that would
// be deleted under the default "keep the oldest-created copy in each
// group" rule, without actually deleting anything — used both to preview
// the bulk action and to perform it.
// ---------------------------------------------------------------------------
export function getDefaultDeletionIds(groups) {
  const ids = [];
  for (const group of groups) {
    for (let i = 1; i < group.length; i++) {
      ids.push(group[i].id);
    }
  }
  return ids;
}
