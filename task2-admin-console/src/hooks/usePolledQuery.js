// Fetch something keyed by `key`, then keep it fresh by polling.
//
// Two kinds of fetch are deliberately treated differently:
//  - User-driven (the key changed, or Retry): replaces the data. While it
//    runs, the previous data stays on screen with status 'refreshing'.
//  - Background poll: never shows a loading state or wipes the view. The
//    result goes through `applyPoll` (which can merge it in place or hold it
//    back), and a failure only sets `refreshError`; the last good data stays.

import { useCallback, useEffect, useRef, useState } from 'react';

const INITIAL = {
  status: 'loading', // loading | refreshing | success | error
  data: null,
  dataKey: null,
  error: null,
  refreshError: null,
  updatedAt: null,
};

const replaceOnPoll = (state, data) => ({ ...state, data, updatedAt: Date.now() });

export function usePolledQuery(key, load, { pollMs, autoRefresh = true, applyPoll = replaceOnPoll }) {
  const [state, setState] = useState(INITIAL);
  const [reloadToken, setReloadToken] = useState(0);
  const loadRef = useRef(load);
  const applyPollRef = useRef(applyPoll);
  useEffect(() => {
    loadRef.current = load;
    applyPollRef.current = applyPoll;
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));

    loadRef.current(key, controller.signal).then(
      // Start from INITIAL so poll-only fields (held-back pages, changed cells) are dropped.
      (data) => setState({ ...INITIAL, status: 'success', data, dataKey: key, updatedAt: Date.now() }),
      (error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, status: 'error', error }));
      },
    );
    return () => controller.abort();
  }, [key, reloadToken]);

  const pollingEnabled = autoRefresh && state.status === 'success';
  useEffect(() => {
    if (!pollingEnabled) return undefined;
    let timer;
    let controller;
    let cancelled = false;

    const tick = async () => {
      // Skip polls while the tab is hidden; nobody is looking.
      if (!document.hidden) {
        controller = new AbortController();
        try {
          const data = await loadRef.current(key, controller.signal);
          setState((s) => (s.dataKey === key && s.status === 'success'
            ? { ...applyPollRef.current(s, data), refreshError: null }
            : s));
        } catch (error) {
          if (error.name !== 'AbortError') setState((s) => ({ ...s, refreshError: error }));
        }
      }
      if (!cancelled) timer = setTimeout(tick, pollMs);
    };

    timer = setTimeout(tick, pollMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [key, pollMs, pollingEnabled]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);
  return { ...state, setState, retry };
}
