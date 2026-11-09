import { useEffect, useId, useMemo, useState } from 'react';
import { datePresets, isoDay, matchPreset, rangeError } from '../lib/dates.js';
import { inputClass, selectClass } from './ui/Field.jsx';

// Filters both the chart and the table on signup date. Changes are applied as
// soon as the range is valid; an invalid range shows an error and is not applied.
export function DateRangeFilter({ from, to, onChange }) {
  const id = useId();
  const presets = useMemo(() => datePresets(isoDay(new Date())), []);
  const [draft, setDraft] = useState({ from, to });
  const [customOpen, setCustomOpen] = useState(false);

  // Follow the URL when it changes underneath us (back/forward, "clear filters").
  useEffect(() => setDraft({ from, to }), [from, to]);

  const preset = customOpen ? 'custom' : matchPreset(presets, from, to);
  const error = rangeError(draft.from, draft.to);

  const choosePreset = (presetId) => {
    if (presetId === 'custom') {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    const chosen = presets.find((p) => p.id === presetId);
    onChange({ dateFrom: chosen.from, dateTo: chosen.to });
  };

  const changeDate = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (!rangeError(next.from, next.to)) onChange({ dateFrom: next.from, dateTo: next.to });
  };

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Signup date range</legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-44">
          <label htmlFor={`${id}-preset`} className="mb-1 block text-xs font-semibold text-muted">Signed up</label>
          <select id={`${id}-preset`} className={selectClass} value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="custom">Custom range…</option>
          </select>
        </div>
        {(preset === 'custom' || from || to) && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <div>
              <label htmlFor={`${id}-from`} className="mb-1 block text-xs font-semibold text-muted">From</label>
              <input
                id={`${id}-from`}
                type="date"
                className={`${inputClass} date-input sm:w-40`}
                value={draft.from}
                max={draft.to || undefined}
                onChange={(e) => changeDate('from', e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className="mb-1 block text-xs font-semibold text-muted">To</label>
              <input
                id={`${id}-to`}
                type="date"
                className={`${inputClass} date-input sm:w-40`}
                value={draft.to}
                min={draft.from || undefined}
                onChange={(e) => changeDate('to', e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </div>
          </div>
        )}
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm font-medium text-rose-700">{error}</p>}
    </fieldset>
  );
}
