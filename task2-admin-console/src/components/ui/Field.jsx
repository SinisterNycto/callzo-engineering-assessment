// Label + control + hint/error, wired together with ids so screen readers
// announce the error when the control is focused.

import { cloneElement, useId } from 'react';

export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}</label>
      {hint && <p id={hintId} className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-1.5">
        {cloneElement(children, {
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
        })}
      </div>
      {/* The error line's space is always reserved, so showing an error on
          blur never shifts the layout (which would make the next click miss). */}
      <p id={errorId} className="mt-1 min-h-5 text-sm font-medium text-rose-700">{error}</p>
    </div>
  );
}

export const inputClass =
  'block h-10 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-slate-400 ' +
  'hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100 ' +
  'aria-invalid:border-rose-400 aria-invalid:focus:ring-rose-100 disabled:bg-canvas';

export const selectClass = `${inputClass} select-chevron pr-9`;
