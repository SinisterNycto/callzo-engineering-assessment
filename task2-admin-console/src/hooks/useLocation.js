// A very small router: two pages don't justify a routing library, and the
// assignment limits dependencies anyway. The URL is the source of truth;
// navigate() updates it and notifies subscribers through a popstate event.

import { useSyncExternalStore } from 'react';

function subscribe(callback) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

const currentHref = () => window.location.pathname + window.location.search;

export function useLocation() {
  const href = useSyncExternalStore(subscribe, currentHref);
  const url = new URL(href, window.location.origin);
  return { pathname: url.pathname, search: url.search };
}

export function navigate(to, { replace = false } = {}) {
  if (to === currentHref()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function matchSettingsRoute(pathname) {
  const match = pathname.match(/^\/accounts\/(\d+)\/settings\/?$/);
  return match ? Number(match[1]) : null;
}
