import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountsToCsv } from '../src/lib/csv.js';
import { bucketSeries, chooseGranularity, totals } from '../src/lib/series.js';

const day = (date, minutes = 1) => ({ date, minutes, sms: 1, cost_cents: 100, signups: 1 });

function daily(from, count) {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => day(new Date(start + i * 86_400_000).toISOString().slice(0, 10)));
}

describe('bucketSeries', () => {
  it('picks a granularity from the span', () => {
    assert.equal(chooseGranularity(daily('2026-01-01', 30)), 'day');
    assert.equal(chooseGranularity(daily('2026-01-01', 200)), 'week');
    assert.equal(chooseGranularity(daily('2024-01-01', 900)), 'month');
  });

  it('sums into months without losing anything', () => {
    const series = daily('2026-01-01', 59); // Jan + Feb 2026
    const { points } = bucketSeries(series, 'month');
    assert.deepEqual(points.map((p) => p.date), ['2026-01-01', '2026-02-01']);
    assert.equal(points[0].minutes, 31);
    assert.deepEqual(totals(points), totals(series));
  });

  it('weeks start on Monday', () => {
    const { points } = bucketSeries(daily('2026-11-04', 7), 'week'); // Wed..Tue
    assert.deepEqual(points.map((p) => p.date), ['2026-11-02', '2026-11-09']);
  });

  it('flags buckets the range only partly covers', () => {
    const { points } = bucketSeries(daily('2026-10-01', 32), 'month'); // all Oct + 1 Nov
    assert.deepEqual(points.map((p) => p.partial), [false, true]);
  });
});

describe('accountsToCsv', () => {
  it('quotes commas and neutralises spreadsheet formulas', () => {
    const csv = accountsToCsv([{ id: 1, name: '=HYPERLINK("x")', company: 'Acme, Inc' }]);
    const line = csv.split('\n')[1];
    assert.ok(line.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(line.includes('"Acme, Inc"'));
  });
});
