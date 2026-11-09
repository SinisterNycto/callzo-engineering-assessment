const COLUMNS = [
  ['id', 'ID'],
  ['name', 'Name'],
  ['email', 'Email'],
  ['company', 'Company'],
  ['country', 'Country'],
  ['plan', 'Plan'],
  ['status', 'Status'],
  ['signup_date', 'Signup date'],
  ['current_month_minutes', 'Minutes (this month)'],
  ['current_month_sms', 'SMS (this month)'],
  ['cost_cents', 'Cost (cents)'],
  ['last_active', 'Last active'],
];

function escapeCell(value) {
  const text = String(value ?? '');
  // Leading = + - @ would be treated as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function accountsToCsv(rows) {
  const header = COLUMNS.map(([, label]) => label).join(',');
  const lines = rows.map((row) => COLUMNS.map(([key]) => escapeCell(row[key])).join(','));
  return [header, ...lines].join('\n');
}
