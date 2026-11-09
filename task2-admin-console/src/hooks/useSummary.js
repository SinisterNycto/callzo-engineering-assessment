import { api } from '../lib/api.js';
import { withRetry } from '../lib/retry.js';
import { usePolledQuery } from './usePolledQuery.js';

const POLL_MS = 60_000;

// /accounts/summary fails ~1 in 5 calls by design, so retry quietly twice
// before showing an error. Three straight failures is rare (~1%) and
// gets an inline error with a Retry button.
const loadSummary = (params, signal) =>
  withRetry(() => api.getSummary(params, signal), { signal });

export function useSummary(dateFrom, dateTo, { autoRefresh }) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  return usePolledQuery(params.toString(), loadSummary, { pollMs: POLL_MS, autoRefresh });
}
