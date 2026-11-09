// Calendar-date helpers. Everything is a "YYYY-MM-DD" string in UTC.

export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysBefore(today, days) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDay(d);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function datePresets(today) {
  const year = Number(today.slice(0, 4));
  return [
    { id: 'all', label: 'All time', from: '', to: '' },
    { id: '30d', label: 'Last 30 days', from: daysBefore(today, 29), to: today },
    { id: '90d', label: 'Last 90 days', from: daysBefore(today, 89), to: today },
    { id: 'ytd', label: `${year} to date`, from: `${year}-01-01`, to: today },
    { id: 'prev', label: String(year - 1), from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
}

export function matchPreset(presets, from, to) {
  return presets.find((p) => p.from === from && p.to === to)?.id ?? 'custom';
}

export function rangeError(from, to) {
  if (from && to && from > to) return 'Start date must be on or before the end date.';
  return '';
}
