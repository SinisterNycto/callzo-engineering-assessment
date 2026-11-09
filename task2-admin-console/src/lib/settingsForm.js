// Rules for the 4-step settings form, kept free of React so they can be
// unit-tested. Inputs hold strings ("drafts"); the API takes typed payloads.

export const BILLING_COUNTRIES = [
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['IN', 'India'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
];

export const STEPS = [
  { number: 1, title: 'Contact', description: 'Who we contact about this account.', fields: ['name', 'email'] },
  { number: 2, title: 'Billing', description: 'Plan and the country we bill in.', fields: ['plan', 'billing_country'] },
  { number: 3, title: 'Usage caps', description: 'Optional monthly limits. Leave blank for no cap.', fields: ['minutes_cap', 'sms_cap'] },
  { number: 4, title: 'Webhook', description: 'Optional endpoint for usage notifications.', fields: ['webhook_url'] },
];

export const STEP_NUMBERS = STEPS.map((s) => s.number);

const EMPTY_DRAFT = {
  1: { name: '', email: '' },
  2: { plan: '', billing_country: '' },
  3: { minutes_cap: '', sms_cap: '' },
  4: { webhook_url: '' },
};

export function validateStep(step, draft) {
  const errors = {};
  if (step === 1) {
    if (!draft.name.trim()) errors.name = 'Enter a contact name.';
    if (!draft.email.trim()) errors.email = 'Enter an email address.';
    else if (!/^[^\s@]+@[^\s@]+$/.test(draft.email.trim())) errors.email = 'Enter an email address like name@company.com.';
  }
  if (step === 2) {
    if (!draft.plan) errors.plan = 'Choose a plan.';
    if (!draft.billing_country) errors.billing_country = 'Choose a billing country.';
  }
  if (step === 3) {
    for (const field of ['minutes_cap', 'sms_cap']) {
      const value = draft[field].trim();
      if (value && !/^\d+$/.test(value)) errors[field] = 'Use a whole number, or leave it blank.';
    }
  }
  if (step === 4) {
    const url = draft.webhook_url.trim();
    if (url && !/^https?:\/\/\S+$/.test(url)) errors.webhook_url = 'The URL must start with http:// or https://';
  }
  return errors;
}

// The API rejects null for the optional caps, so blank fields are left out.
export function toPayload(step, draft) {
  if (step === 1) return { name: draft.name.trim(), email: draft.email.trim() };
  if (step === 2) return { plan: draft.plan, billing_country: draft.billing_country };
  if (step === 3) {
    const payload = {};
    if (draft.minutes_cap.trim()) payload.minutes_cap = Number(draft.minutes_cap);
    if (draft.sms_cap.trim()) payload.sms_cap = Number(draft.sms_cap);
    return payload;
  }
  return { webhook_url: draft.webhook_url.trim() };
}

export function toDraft(step, data = {}) {
  const draft = { ...EMPTY_DRAFT[step] };
  for (const key of Object.keys(draft)) {
    if (data[key] !== undefined && data[key] !== null) draft[key] = String(data[key]);
  }
  return draft;
}

export function samePayload(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]);
}

// Build the starting drafts: whatever the server has saved, otherwise
// sensible values from the account record so the user isn't retyping.
export function initialDrafts(saved, account) {
  const drafts = {};
  for (const step of STEP_NUMBERS) drafts[step] = toDraft(step, saved[step]);

  if (!saved[1] && account) drafts[1] = toDraft(1, { name: account.name, email: account.email });
  if (!saved[2] && account) {
    const country = BILLING_COUNTRIES.some(([code]) => code === account.country) ? account.country : '';
    drafts[2] = toDraft(2, { plan: account.plan, billing_country: country });
  }
  return drafts;
}

// Normalise GET /settings ({"1": {...}}) to numeric keys.
export function normaliseSaved(response) {
  const saved = {};
  for (const step of STEP_NUMBERS) {
    if (response?.[step]) saved[step] = response[step];
  }
  return saved;
}

// You can go to any step you've already saved, plus the first one you haven't.
// Steps are saved in order, so step 4 never exists on the server without step 2.
export function furthestReachableStep(saved) {
  let step = 1;
  while (step < 4 && saved[step]) step += 1;
  return step;
}

// 422 bodies look like {"detail": {"step": 2, "errors": {"field": "message"}}}.
// The step comes from the server, not from the step we were on, so the error
// always lands where it belongs.
export function parseStepError(error) {
  const detail = error?.body?.detail;
  if (error?.status !== 422 || typeof detail?.step !== 'number' || typeof detail.errors !== 'object') return null;
  return { step: detail.step, errors: detail.errors };
}

// 400 from submit: {"detail": {"error": "incomplete form", "missing_steps": [2, 3]}}
export function parseMissingSteps(error) {
  const missing = error?.body?.detail?.missing_steps;
  return error?.status === 400 && Array.isArray(missing) ? missing : null;
}

export function describeSaved(step, data) {
  if (!data) return 'Not saved yet';
  if (step === 1) return `${data.name} · ${data.email}`;
  if (step === 2) {
    const country = BILLING_COUNTRIES.find(([code]) => code === data.billing_country)?.[1] ?? data.billing_country;
    return `${capitalise(data.plan)} · ${country}`;
  }
  if (step === 3) {
    const caps = [
      data.minutes_cap !== undefined ? `${data.minutes_cap} min` : null,
      data.sms_cap !== undefined ? `${data.sms_cap} SMS` : null,
    ].filter(Boolean);
    return caps.length ? caps.join(' · ') : 'No caps';
  }
  return data.webhook_url || 'No webhook';
}

export function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}
