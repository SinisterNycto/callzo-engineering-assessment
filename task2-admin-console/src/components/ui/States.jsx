import { Button } from './Button.jsx';

export function Spinner({ className = 'size-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-slate-200/70 ${className}`} />;
}

export function ErrorState({ title, message, onRetry, compact = false }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-2 py-6' : 'gap-3 py-12'}`}>
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-rose-50 text-rose-600">
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 14.75a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
      </span>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-canvas text-muted">
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3 3" strokeLinecap="round" /></svg>
      </span>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      </div>
      {action}
    </div>
  );
}

// A thin top bar on a card while it reloads data it is already showing.
export function RefreshBar({ active }) {
  if (!active) return null;
  return (
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-2xl bg-brand-100">
      <span className="block h-full w-1/3 animate-pulse bg-brand-500" />
    </span>
  );
}
