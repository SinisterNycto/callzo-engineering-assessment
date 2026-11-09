// The accounts list query lives in the URL. This module converts between
// three shapes of it: the URL search string, the in-memory object the UI
// reads, and the query params the mock API expects.

export const STATUSES = ['active', 'trial', 'suspended'];
export const PLANS = ['basic', 'pro', 'enterprise'];
export const COUNTRIES = ['AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'NG', 'PK', 'US'];
export const PAGE_SIZES = [25, 50, 100];
export const SORTABLE = [
  'id', 'name', 'company', 'country', 'plan', 'status', 'signup_date',
  'current_month_minutes', 'current_month_sms', 'cost_cents', 'last_active',
];

export const DEFAULT_QUERY = Object.freeze({
  search: '',
  status: '',
  plan: '',
  country: '',
  dateFrom: '',
  dateTo: '',
  sortBy: 'id',
  sortDir: 'asc',
  page: 1,
  pageSize: 50,
});

// UI key -> [url param, api param]
const PARAMS = {
  search: ['q', 'search'],
  status: ['status', 'status'],
  plan: ['plan', 'plan'],
  country: ['country', 'country'],
  dateFrom: ['from', 'date_from'],
  dateTo: ['to', 'date_to'],
  sortBy: ['sort', 'sort_by'],
  sortDir: ['dir', 'sort_dir'],
  page: ['page', 'page'],
  pageSize: ['size', 'page_size'],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Anything in the URL is user-editable, so every field is validated and
// unknown values fall back to the default instead of reaching the API.
export function queryFromSearch(search) {
  const params = new URLSearchParams(search);
  const get = (key) => params.get(PARAMS[key][0]) ?? '';
  const date = (key) => (ISO_DATE.test(get(key)) ? get(key) : '');

  return {
    search: get('search').slice(0, 100),
    status: oneOf(get('status'), STATUSES, ''),
    plan: oneOf(get('plan'), PLANS, ''),
    country: oneOf(get('country'), COUNTRIES, ''),
    dateFrom: date('dateFrom'),
    dateTo: date('dateTo'),
    sortBy: oneOf(get('sortBy'), SORTABLE, DEFAULT_QUERY.sortBy),
    sortDir: oneOf(get('sortDir'), ['asc', 'desc'], DEFAULT_QUERY.sortDir),
    page: positiveInt(get('page'), DEFAULT_QUERY.page),
    pageSize: oneOf(positiveInt(get('pageSize'), DEFAULT_QUERY.pageSize), PAGE_SIZES, DEFAULT_QUERY.pageSize),
  };
}

// Defaults are left out so a fresh page has a clean URL.
export function searchFromQuery(query) {
  const params = new URLSearchParams();
  for (const [key, [urlName]] of Object.entries(PARAMS)) {
    const value = query[key];
    if (value !== '' && value !== DEFAULT_QUERY[key]) params.set(urlName, String(value));
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

export function toApiParams(query) {
  const params = new URLSearchParams();
  for (const [key, [, apiName]] of Object.entries(PARAMS)) {
    const value = query[key];
    if (key === 'search' && value.trim() === '') continue;
    if (value !== '') params.set(apiName, key === 'search' ? value.trim() : String(value));
  }
  return params;
}

// Any change other than paging sends you back to page 1, otherwise
// you can land on page 40 of a result set that now has 2 pages.
export function updateQuery(query, patch) {
  const next = { ...query, ...patch };
  const onlyPaging = Object.keys(patch).every((k) => k === 'page');
  if (!onlyPaging) next.page = 1;
  return next;
}

export function hasActiveFilters(query) {
  return ['search', 'status', 'plan', 'country', 'dateFrom', 'dateTo'].some((k) => query[k] !== '');
}

export function clearFilters(query) {
  return updateQuery(query, { search: '', status: '', plan: '', country: '', dateFrom: '', dateTo: '' });
}
