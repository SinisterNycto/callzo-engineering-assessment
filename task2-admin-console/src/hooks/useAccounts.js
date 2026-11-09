import { useCallback } from 'react';
import { api } from '../lib/api.js';
import { mergeRefresh } from '../lib/refresh.js';
import { usePolledQuery } from './usePolledQuery.js';

const POLL_MS = 20_000;
const NO_CHANGES = new Map();

const loadAccounts = (params, signal) => api.listAccounts(params, signal);

// Same rows as on screen -> update values in place, keep the order, and
// remember which cells changed. Different rows -> hold the page back as
// `pending` and let the user choose when to swap it in.
function applyAccountsPoll(state, incoming) {
  const merged = mergeRefresh(state.data.data, incoming.data);
  if (!merged) return { ...state, pending: incoming };
  return {
    ...state,
    data: { ...incoming, data: merged.rows },
    changed: merged.changed,
    changeTick: (state.changeTick ?? 0) + 1,
    pending: null,
    updatedAt: Date.now(),
  };
}

export function useAccounts(params, { autoRefresh }) {
  const query = usePolledQuery(params, loadAccounts, {
    pollMs: POLL_MS,
    autoRefresh,
    applyPoll: applyAccountsPoll,
  });
  const { setState } = query;

  const showPending = useCallback(() => {
    setState((s) => (s.pending
      ? { ...s, data: s.pending, pending: null, changed: NO_CHANGES, updatedAt: Date.now() }
      : s));
  }, [setState]);

  return {
    ...query,
    pending: query.pending ?? null,
    changed: query.changed ?? NO_CHANGES,
    changeTick: query.changeTick ?? 0,
    showPending,
  };
}
