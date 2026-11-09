import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeRefresh } from '../src/lib/refresh.js';
import { isRetryable, withRetry } from '../src/lib/retry.js';

const row = (id, minutes, cost = 100) => ({ id, name: `A${id}`, current_month_minutes: minutes, current_month_sms: 1, cost_cents: cost, last_active: '2026-01-01', status: 'active', plan: 'pro' });

describe('mergeRefresh', () => {
  it('keeps on-screen order when the server returns the same rows reordered', () => {
    const current = [row(1, 10), row(2, 20), row(3, 30)];
    const incoming = [row(3, 30), row(1, 15), row(2, 20)];
    const merged = mergeRefresh(current, incoming);
    assert.deepEqual(merged.rows.map((r) => r.id), [1, 2, 3]);
    assert.equal(merged.rows[0].current_month_minutes, 15);
  });

  it('reports exactly which fields changed', () => {
    const merged = mergeRefresh([row(1, 10, 100), row(2, 20)], [row(1, 11, 105), row(2, 20)]);
    assert.deepEqual([...merged.changed.get(1)].sort(), ['cost_cents', 'current_month_minutes']);
    assert.equal(merged.changed.has(2), false);
  });

  it('refuses to merge when the set of rows differs', () => {
    assert.equal(mergeRefresh([row(1, 10), row(2, 20)], [row(1, 10), row(9, 20)]), null);
    assert.equal(mergeRefresh([row(1, 10)], [row(1, 10), row(2, 20)]), null);
  });
});

describe('withRetry', () => {
  const noWait = async () => {};
  const serverError = Object.assign(new Error('boom'), { status: 500 });
  const badRequest = Object.assign(new Error('bad'), { status: 422 });

  it('retries 5xx and returns the first success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw serverError;
      return 'ok';
    }, { wait: noWait });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  it('gives up after the configured attempts', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls += 1; throw serverError; }, { delays: [0, 0], wait: noWait }));
    assert.equal(calls, 3);
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls += 1; throw badRequest; }, { wait: noWait }));
    assert.equal(calls, 1);
  });

  it('classifies errors', () => {
    assert.equal(isRetryable({ status: 0 }), true);
    assert.equal(isRetryable({ status: 503 }), true);
    assert.equal(isRetryable({ status: 404 }), false);
    assert.equal(isRetryable({ name: 'AbortError' }), false);
  });
});
