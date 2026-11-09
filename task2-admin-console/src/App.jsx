import { useEffect, useRef } from 'react';
import { Shell } from './components/Shell.jsx';
import { Link } from './components/Link.jsx';
import { matchSettingsRoute, useLocation } from './hooks/useLocation.js';
import { useSelection } from './hooks/useSelection.js';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

export default function App() {
  const { pathname, search } = useLocation();
  // Selection lives above the router so it survives a trip to an account's
  // settings and back.
  const selection = useSelection();
  const settingsId = matchSettingsRoute(pathname);
  const lastPathname = useRef(pathname);

  // On a page change, scroll to the top and move focus to the new page's
  // heading, so keyboard and screen-reader users land at the start of the page.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    window.scrollTo(0, 0);
    document.querySelector('main h1')?.focus();
  }, [pathname]);

  if (pathname === '/') {
    return (
      <Shell current="overview">
        <OverviewPage search={search} selection={selection} />
      </Shell>
    );
  }
  if (settingsId !== null) {
    return (
      <Shell current="settings">
        <SettingsPage key={settingsId} accountId={settingsId} search={search} />
      </Shell>
    );
  }
  return (
    <Shell current="none">
      <div className="py-24 text-center">
        <h1 tabIndex={-1} className="text-2xl font-bold focus:outline-none">Page not found</h1>
        <p className="mt-2 text-muted">There's nothing at {pathname}.</p>
        <Link href="/" className="mt-6 inline-block font-semibold text-brand-700 underline underline-offset-4">Back to accounts</Link>
      </div>
    </Shell>
  );
}
