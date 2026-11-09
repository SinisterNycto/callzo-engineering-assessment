import { useEffect, useMemo, useRef } from 'react';

export function useDebouncedCallback(callback, delayMs) {
  const callbackRef = useRef(callback);
  const timer = useRef(null);
  useEffect(() => {
    callbackRef.current = callback;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(() => {
    const debounced = (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => callbackRef.current(...args), delayMs);
    };
    debounced.cancel = () => clearTimeout(timer.current);
    return debounced;
  }, [delayMs]);
}
