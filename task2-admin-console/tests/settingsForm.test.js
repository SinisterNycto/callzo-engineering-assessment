import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  furthestReachableStep, initialDrafts, normaliseSaved, parseMissingSteps, parseStepError,
  samePayload, toDraft, toPayload, validateStep,
} from '../src/lib/settingsForm.js';

describe('validateStep', () => {
  it('step 1 needs a name and an email with @', () => {
    assert.deepEqual(Object.keys(validateStep(1, { name: ' ', email: 'nope' })).sort(), ['email', 'name']);
    assert.deepEqual(validateStep(1, { name: 'Ana', email: 'ana@x.io' }), {});
  });

  it('step 2 needs both selects', () => {
    assert.deepEqual(Object.keys(validateStep(2, { plan: 'pro', billing_country: '' })), ['billing_country']);
  });

  it('step 3 caps are optional whole numbers', () => {
    assert.deepEqual(validateStep(3, { minutes_cap: '', sms_cap: '' }), {});
    assert.deepEqual(Object.keys(validateStep(3, { minutes_cap: '1.5', sms_cap: '-2' })).sort(), ['minutes_cap', 'sms_cap']);
  });

  it('step 4 webhook must be http(s) if given', () => {
    assert.deepEqual(validateStep(4, { webhook_url: '' }), {});
    assert.ok(validateStep(4, { webhook_url: 'ftp://x' }).webhook_url);
    assert.deepEqual(validateStep(4, { webhook_url: 'https://x.io/h' }), {});
  });
});

describe('payloads', () => {
  it('omits blank caps (the API rejects null) and converts numbers', () => {
    assert.deepEqual(toPayload(3, { minutes_cap: '500', sms_cap: '' }), { minutes_cap: 500 });
    assert.deepEqual(toPayload(3, { minutes_cap: '', sms_cap: '' }), {});
  });

  it('drafts round-trip through payloads', () => {
    const saved = { minutes_cap: 500 };
    assert.ok(samePayload(toPayload(3, toDraft(3, saved)), saved));
  });

  it('samePayload treats a never-saved step as different', () => {
    assert.equal(samePayload({}, undefined), false);
  });
});

describe('initialDrafts', () => {
  const account = { name: 'Ana', email: 'ana@x.io', plan: 'pro', country: 'DE' };

  it('prefills unsaved steps from the account, ignoring countries we cannot bill in', () => {
    const drafts = initialDrafts({}, account);
    assert.equal(drafts[1].name, 'Ana');
    assert.equal(drafts[2].plan, 'pro');
    assert.equal(drafts[2].billing_country, '');
  });

  it('prefers saved values over the account', () => {
    const drafts = initialDrafts({ 1: { name: 'Saved', email: 's@x.io' } }, account);
    assert.equal(drafts[1].name, 'Saved');
  });
});

describe('step order', () => {
  it('you can reach every saved step plus the next one', () => {
    assert.equal(furthestReachableStep({}), 1);
    assert.equal(furthestReachableStep({ 1: {}, 2: {} }), 3);
    assert.equal(furthestReachableStep({ 1: {}, 2: {}, 3: {}, 4: {} }), 4);
  });

  it('a gap stops progress (step 4 without step 2 is not reachable)', () => {
    assert.equal(furthestReachableStep({ 1: {}, 4: {} }), 2);
  });

  it('normalises string step keys from the API', () => {
    assert.deepEqual(Object.keys(normaliseSaved({ 1: { a: 1 }, 3: { b: 2 } })), ['1', '3']);
  });
});

describe('server errors', () => {
  it('routes a 422 to the step named in the body, not the one being viewed', () => {
    const error = { status: 422, body: { detail: { step: 2, errors: { billing_country: 'billing_country is required' } } } };
    assert.deepEqual(parseStepError(error), { step: 2, errors: { billing_country: 'billing_country is required' } });
  });

  it('ignores FastAPI-style 422s without a step', () => {
    assert.equal(parseStepError({ status: 422, body: { detail: [{ loc: ['body'] }] } }), null);
    assert.equal(parseStepError({ status: 500, body: null }), null);
  });

  it('reads missing steps from a 400 on submit', () => {
    assert.deepEqual(parseMissingSteps({ status: 400, body: { detail: { error: 'incomplete form', missing_steps: [2, 3] } } }), [2, 3]);
  });
});
