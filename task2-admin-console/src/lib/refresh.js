// Background refresh without moving rows under the user.
//
// When a poll returns the same set of row ids as what's on screen, we keep
// the on-screen order and only swap in new values, recording which cells
// changed so they can be highlighted. If the set of ids differs (a row
// dropped out of this page, a new one sorted in), we don't touch the table
// at all; the caller holds the new page and offers it to the user instead.

export const LIVE_FIELDS = ['current_month_minutes', 'current_month_sms', 'cost_cents', 'last_active', 'status', 'plan'];

export function mergeRefresh(currentRows, incomingRows) {
  if (currentRows.length !== incomingRows.length) return null;

  const incomingById = new Map(incomingRows.map((row) => [row.id, row]));
  if (currentRows.some((row) => !incomingById.has(row.id))) return null;

  const changed = new Map();
  const rows = currentRows.map((row) => {
    const next = incomingById.get(row.id);
    const fields = LIVE_FIELDS.filter((field) => row[field] !== next[field]);
    if (fields.length) changed.set(row.id, new Set(fields));
    return next;
  });

  return { rows, changed };
}
