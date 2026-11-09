// The summary endpoint returns one point per day. Over a long range that's
// 1,000+ points, too dense to read, so we bucket by week or month
// depending on how wide the range is.

import { daysBetween } from './dates.js';

export const METRICS = {
  minutes: { label: 'Minutes', field: 'minutes' },
  sms: { label: 'SMS', field: 'sms' },
  cost: { label: 'Cost', field: 'cost_cents' },
  signups: { label: 'Signups', field: 'signups' },
};

export function chooseGranularity(series) {
  if (series.length < 2) return 'day';
  const span = daysBetween(series[0].date, series[series.length - 1].date);
  if (span <= 92) return 'day';
  if (span <= 731) return 'week';
  return 'month';
}

function bucketStart(iso, granularity) {
  if (granularity === 'day') return iso;
  if (granularity === 'month') return `${iso.slice(0, 7)}-01`;
  // ISO week, starting Monday.
  const d = new Date(`${iso}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function daysInBucket(start, granularity) {
  if (granularity === 'day') return 1;
  if (granularity === 'week') return 7;
  const d = new Date(`${start}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// A bucket is `partial` when the range only covers some of its days (e.g. the
// current month so far). The chart says so, so a short final bucket reads as
// "not over yet" rather than "usage collapsed".
export function bucketSeries(series, granularity = chooseGranularity(series)) {
  const buckets = new Map();
  for (const point of series) {
    const key = bucketStart(point.date, granularity);
    const bucket = buckets.get(key) ?? { date: key, minutes: 0, sms: 0, cost_cents: 0, signups: 0, days: 0 };
    bucket.minutes += point.minutes;
    bucket.sms += point.sms;
    bucket.cost_cents += point.cost_cents;
    bucket.signups += point.signups;
    bucket.days += 1;
    buckets.set(key, bucket);
  }
  const points = [...buckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ days, ...bucket }) => ({ ...bucket, partial: days < daysInBucket(bucket.date, granularity) }));
  return { granularity, points };
}

export function totals(series) {
  return series.reduce(
    (acc, p) => ({
      minutes: acc.minutes + p.minutes,
      sms: acc.sms + p.sms,
      cost_cents: acc.cost_cents + p.cost_cents,
      signups: acc.signups + p.signups,
    }),
    { minutes: 0, sms: 0, cost_cents: 0, signups: 0 },
  );
}

// Downsample to at most n bars for the small sparklines on the stat tiles.
export function sparkline(series, field, n = 24) {
  if (series.length === 0) return [];
  const size = Math.ceil(series.length / n);
  const bars = [];
  for (let i = 0; i < series.length; i += size) {
    bars.push(series.slice(i, i + size).reduce((sum, p) => sum + p[field], 0));
  }
  return bars;
}
