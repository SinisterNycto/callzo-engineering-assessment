const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Money arrives as integer cents and stays that way until it's displayed.
export const formatCents = (cents) => usd.format(cents / 100);
export const formatCentsCompact = (cents) => usdCompact.format(cents / 100);
export const formatNumber = (n) => whole.format(n);
export const formatCompact = (n) => compact.format(n);

// API dates are calendar dates ("2025-03-14"). Parse and format them as UTC so
// a viewer west of Greenwich doesn't see the day before.
const parseDay = (iso) => new Date(`${iso}T00:00:00Z`);
export const formatDay = (iso) => dayFormat.format(parseDay(iso));
export const formatDayShort = (iso) => dayMonthFormat.format(parseDay(iso));
export const formatMonth = (iso) => monthFormat.format(parseDay(iso));
export const formatTime = (ms) => timeFormat.format(new Date(ms));
