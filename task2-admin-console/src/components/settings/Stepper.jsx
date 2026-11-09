import { STEPS } from '../../lib/settingsForm.js';

const STATUS_TEXT = {
  done: 'saved',
  error: 'needs attention',
  saving: 'saving',
  unsaved: 'unsaved changes',
  todo: 'not started',
  locked: 'locked until the previous step is saved',
};

function Marker({ number, status, current }) {
  const base = 'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ring-inset';
  if (status === 'error') return <span className={`${base} bg-rose-50 text-rose-700 ring-rose-300`} aria-hidden="true">!</span>;
  if (status === 'done') {
    return (
      <span className={`${base} ${current ? 'bg-ink text-white ring-ink' : 'bg-brand-50 text-brand-700 ring-brand-200'}`} aria-hidden="true">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }
  return (
    <span className={`${base} ${current ? 'bg-ink text-white ring-ink' : 'bg-white text-muted ring-line'}`} aria-hidden="true">
      {number}
    </span>
  );
}

export function Stepper({ current, statusOf, reachable, onSelect }) {
  return (
    <nav aria-label="Settings steps">
      <ol className="grid grid-cols-4 gap-1.5 sm:gap-3">
        {STEPS.map((step) => {
          const status = step.number > reachable ? 'locked' : statusOf(step.number);
          const isCurrent = step.number === current;
          return (
            <li key={step.number} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(step.number)}
                disabled={status === 'locked'}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex w-full flex-col items-center gap-1.5 rounded-xl border px-1 py-2 text-center transition-colors sm:flex-row sm:px-3 sm:text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  isCurrent ? 'border-ink/15 bg-white shadow-sm' : 'border-transparent hover:bg-white/70'
                }`}
              >
                <Marker number={step.number} status={status} current={isCurrent} />
                <span className="min-w-0">
                  <span className="sr-only">Step {step.number}: </span>
                  <span className="block truncate text-xs font-semibold sm:text-sm">{step.title}</span>
                  <span className="sr-only">, {STATUS_TEXT[status]}</span>
                  <span aria-hidden="true" className="hidden text-xs text-muted sm:block">{STATUS_TEXT[status]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
