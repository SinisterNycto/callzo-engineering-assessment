import { BILLING_COUNTRIES } from '../../lib/settingsForm.js';
import { PLANS } from '../../lib/query.js';
import { Field, inputClass, selectClass } from '../ui/Field.jsx';

const PLAN_NOTES = {
  basic: 'Pay as you go',
  pro: 'Volume pricing',
  enterprise: 'Custom terms',
};

function PlanPicker({ value, error, onChange, onBlur }) {
  return (
    <fieldset aria-describedby={error ? 'plan-error' : undefined}>
      <legend className="text-sm font-semibold text-ink">Plan</legend>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <label
            key={plan}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 ${
              value === plan ? 'border-brand-500 bg-brand-50/60' : 'border-line hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="plan"
              value={plan}
              checked={value === plan}
              onChange={() => onChange(plan)}
              onBlur={onBlur}
              className="mt-0.5 accent-brand-600"
              aria-invalid={error ? true : undefined}
            />
            <span>
              <span className="block text-sm font-semibold capitalize">{plan}</span>
              <span className="block text-xs text-muted">{PLAN_NOTES[plan]}</span>
            </span>
          </label>
        ))}
      </div>
      <p id="plan-error" className="mt-1 min-h-5 text-sm font-medium text-rose-700">{error}</p>
    </fieldset>
  );
}

// Renders the inputs for one step. `errorFor(field)` decides which message (if
// any) to show; `name` attributes let the page move focus to a field by name.
export function StepFields({ step, draft, errorFor, onChange, onBlur }) {
  const bind = (field) => ({
    name: field,
    value: draft[field],
    onChange: (e) => onChange(field, e.target.value),
    onBlur: () => onBlur(field),
  });

  if (step === 1) {
    return (
      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <Field label="Contact name" error={errorFor('name')}>
          <input type="text" autoComplete="name" className={inputClass} {...bind('name')} />
        </Field>
        <Field label="Contact email" error={errorFor('email')}>
          <input type="email" autoComplete="email" inputMode="email" className={inputClass} {...bind('email')} />
        </Field>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-3">
        <PlanPicker value={draft.plan} error={errorFor('plan')} onChange={(v) => onChange('plan', v)} onBlur={() => onBlur('plan')} />
        <Field label="Billing country" hint="Invoices are issued in this country's currency and tax rules." error={errorFor('billing_country')} className="sm:max-w-xs">
          <select className={selectClass} {...bind('billing_country')}>
            <option value="">Choose a country</option>
            {BILLING_COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <Field label="Minutes cap" hint="Per month. Blank means no cap." error={errorFor('minutes_cap')}>
          <input type="text" inputMode="numeric" autoComplete="off" placeholder="e.g. 5000" className={inputClass} {...bind('minutes_cap')} />
        </Field>
        <Field label="SMS cap" hint="Per month. Blank means no cap." error={errorFor('sms_cap')}>
          <input type="text" inputMode="numeric" autoComplete="off" placeholder="e.g. 1000" className={inputClass} {...bind('sms_cap')} />
        </Field>
      </div>
    );
  }

  return (
    <Field label="Webhook URL" hint="Optional. We POST usage alerts here." error={errorFor('webhook_url')}>
      <input type="url" inputMode="url" autoComplete="url" placeholder="https://example.com/hooks/callzo" className={inputClass} {...bind('webhook_url')} />
    </Field>
  );
}
