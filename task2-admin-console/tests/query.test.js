import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_QUERY, clearFilters, hasActiveFilters, queryFromSearch, searchFromQuery, toApiParams, updateQuery,
} from '../src/lib/query.js';

describe('URL <-> query', () => {
  it('a clean URL gives the defaults, and the defaults give a clean URL', () => {
    assert.deepEqual(queryFromSearch(''), DEFAULT_QUERY);
    assert.equal(searchFromQuery(DEFAULT_QUERY), '');
  });

  it('round-trips a full query', () => {
    const query = {
      ...DEFAULT_QUERY, search: 'patel', status: 'trial', plan: 'pro', country: 'GB',
      dateFrom: '2026-01-01', dateTo: '2026-03-31', sortBy: 'cost_cents', sortDir: 'desc', page: 3, pageSize: 100,
    };
    assert.deepEqual(queryFromSearch(searchFromQuery(query)), query);
  });

  it('drops values that a hand-edited URL could smuggle in', () => {
    const q = queryFromSearch('?status=deleted&plan=gold&sort=password&dir=sideways&page=-4&size=5000&from=yesterday&country=XX');
    assert.equal(q.status, '');
    assert.equal(q.plan, '');
    assert.equal(q.sortBy, 'id');
    assert.equal(q.sortDir, 'asc');
    assert.equal(q.page, 1);
    assert.equal(q.pageSize, 50);
    assert.equal(q.dateFrom, '');
    assert.equal(q.country, '');
  });
});

describe('toApiParams', () => {
  it('uses the API names and skips empty values', () => {
    const params = toApiParams({ ...DEFAULT_QUERY, search: '  patel ', dateFrom: '2026-01-01', sortBy: 'name' });
    assert.equal(params.get('search'), 'patel');
    assert.equal(params.get('date_from'), '2026-01-01');
    assert.equal(params.get('sort_by'), 'name');
    assert.equal(params.has('status'), false);
    assert.equal(params.has('date_to'), false);
  });

  it('omits a whitespace-only search', () => {
    assert.equal(toApiParams({ ...DEFAULT_QUERY, search: '   ' }).has('search'), false);
  });
});

describe('updateQuery', () => {
  it('keeps the page when only paging', () => {
    assert.equal(updateQuery({ ...DEFAULT_QUERY, page: 4 }, { page: 5 }).page, 5);
  });

  it('resets to page 1 on any filter or sort change', () => {
    const q = { ...DEFAULT_QUERY, page: 4 };
    assert.equal(updateQuery(q, { status: 'active' }).page, 1);
    assert.equal(updateQuery(q, { sortBy: 'name' }).page, 1);
    assert.equal(updateQuery(q, { pageSize: 100 }).page, 1);
  });

  it('clearFilters keeps sort but drops filters', () => {
    const q = { ...DEFAULT_QUERY, search: 'x', plan: 'pro', sortBy: 'name', page: 3 };
    const cleared = clearFilters(q);
    assert.equal(hasActiveFilters(cleared), false);
    assert.equal(cleared.sortBy, 'name');
    assert.equal(cleared.page, 1);
  });
});
