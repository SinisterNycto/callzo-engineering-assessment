import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Link } from './Link.jsx';

const HEALTH_POLL_MS = 30_000;

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#0e1726" />
        <path d="M9 20c0-5 3-9 7-9s7 4 7 9" fill="none" stroke="#5ec4c4" strokeWidth="3" strokeLinecap="round" />
        <circle cx="16" cy="21" r="2.5" fill="#5ec4c4" />
      </svg>
      <span className="text-lg font-bold tracking-tight">Callzo</span>
    </span>
  );
}

function NavLinks({ current, onNavigate }) {
  const item = (active) =>
    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
      active ? 'bg-white text-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:bg-white/70'
    }`;

  return (
    <nav aria-label="Main">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Usage</p>
      <ul className="space-y-1">
        <li>
          <Link href="/" className={item(current === 'overview')} aria-current={current === 'overview' ? 'page' : undefined} onClick={onNavigate}>
            <svg viewBox="0 0 20 20" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 16.5h14M5.5 13V9M10 13V5.5M14.5 13v-2.5" strokeLinecap="round" /></svg>
            Accounts &amp; usage
          </Link>
        </li>
        {current === 'settings' && (
          <li>
            <span className={item(true)} aria-current="page">
              <svg viewBox="0 0 20 20" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 5.5h12M4 10h12M4 14.5h7" strokeLinecap="round" /></svg>
              Account settings
            </span>
          </li>
        )}
      </ul>
    </nav>
  );
}

// Small "is the API up" indicator. Polls /health; failure only changes the dot.
function ApiStatus() {
  const [state, setState] = useState('checking');
  useEffect(() => {
    let controller;
    const check = () => {
      controller?.abort();
      controller = new AbortController();
      api.health(controller.signal).then(
        () => setState('up'),
        (error) => error.name !== 'AbortError' && setState('down'),
      );
    };
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, []);

  const label = { checking: 'Checking API…', up: 'Mock API connected', down: 'Mock API unreachable' }[state];
  const dot = { checking: 'bg-slate-300', up: 'bg-emerald-500', down: 'bg-rose-500' }[state];
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-muted" role="status">
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      {label}
    </p>
  );
}

export function Shell({ current, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const menuPanel = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    menuPanel.current?.querySelector('a, button')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 px-4 py-6 lg:flex">
        <div className="px-2"><Logo /></div>
        <NavLinks current={current} />
        <div className="mt-auto rounded-2xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">Workspace</p>
          <p className="mb-3 text-xs text-muted">Internal ops · read &amp; edit</p>
          <ApiStatus />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button
          ref={menuButton}
          type="button"
          className="grid size-10 place-items-center rounded-full border border-line bg-white"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {menuOpen ? <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" /> : <path d="M3.5 6h13M3.5 10h13M3.5 14h13" strokeLinecap="round" />}
          </svg>
        </button>
      </header>
      {menuOpen && (
        <div id="mobile-menu" ref={menuPanel} className="sticky top-16 z-20 space-y-4 border-b border-line bg-canvas px-4 pb-4 pt-2 lg:hidden">
          <NavLinks current={current} onNavigate={() => setMenuOpen(false)} />
          <div className="px-3"><ApiStatus /></div>
        </div>
      )}

      <main id="main" className="min-w-0 flex-1 px-4 pb-10 pt-4 sm:px-6 lg:my-3 lg:mr-3 lg:rounded-3xl lg:border lg:border-line lg:bg-[#fbfbfc] lg:px-8 lg:pt-6">
        {children}
      </main>
    </div>
  );
}
