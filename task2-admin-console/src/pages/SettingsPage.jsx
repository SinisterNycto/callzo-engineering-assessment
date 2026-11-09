import { useEffect, useRef, useState } from 'react';
import { Link } from '../components/Link.jsx';
import { StepFields } from '../components/settings/StepFields.jsx';
import { Stepper } from '../components/settings/Stepper.jsx';
import { PlanBadge, StatusBadge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { ErrorState, Skeleton, Spinner } from '../components/ui/States.jsx';
import { navigate } from '../hooks/useLocation.js';
import { useSettingsForm } from '../hooks/useSettingsForm.js';
import { formatTime } from '../lib/format.js';
import { STEPS, describeSaved, furthestReachableStep, validateStep } from '../lib/settingsForm.js';

function stepFromSearch(search) {
  const n = Number(new URLSearchParams(search).get('step'));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
}

function AccountHeader({ accountId, load, onRetry }) {
  const { account, accountError } = load;
  return (
    <header>
      <p className="text-sm text-muted">
        <Link href="/" className="underline-offset-4 hover:underline">Accounts</Link>
        <span aria-hidden="true"> › </span>
        {account ? account.name : `#${accountId}`}
        <span aria-hidden="true"> › </span>Settings
      </p>
      <h1 tabIndex={-1} className="mt-1 text-3xl font-bold tracking-tight focus:outline-none sm:text-4xl">
        {account ? account.name : `Account #${accountId}`}{' '}
        <span className="font-serif text-[1.15em] font-normal italic">settings</span>
      </h1>
      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2 text-sm text-muted">
        {account && (
          <>
            <span>{account.company}</span>
            <span aria-hidden="true">·</span>
            <span className="break-all">{account.email}</span>
            <PlanBadge plan={account.plan} />
            <StatusBadge status={account.status} />
          </>
        )}
        {!account && !accountError && load.status === 'loading' && <Skeleton className="h-4 w-64" />}
        {accountError && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-rose-800">
            Couldn't load this account's details. The form below still works.
            <Button size="sm" onClick={onRetry}>Retry</Button>
          </p>
        )}
      </div>
    </header>
  );
}

function SaveIndicator({ status, dirty }) {
  let content = null;
  if (status?.state === 'saving') content = <><Spinner className="size-3.5" /> Saving…</>;
  else if (status?.state === 'error') content = <span className="text-rose-700">Not saved</span>;
  else if (dirty) content = 'Unsaved changes';
  else if (status?.state === 'saved') content = `Saved at ${formatTime(status.at)}`;
  return (
    <p aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-sm text-muted">{content}</p>
  );
}

// Shown at the top of a step whose last save failed. Explains what happened,
// shows what is still on file, and offers the two ways out: undo the change
// or try again. The step's saved data never changed, so "undo" is exact.
function SaveErrorPanel({ step, status, serverErrors, savedData, onRevert, onRetry, panelRef }) {
  const saving = status?.state === 'saving';
  const fieldMessages = serverErrors ? Object.values(serverErrors) : [];
  const network = !serverErrors && status?.error;
  return (
    <div ref={panelRef} tabIndex={-1} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950 focus:outline-none">
      <p className="font-bold">Your latest changes to this step weren't saved.</p>
      {fieldMessages.length > 0 && (
        <p className="mt-1">The server replied: {fieldMessages.map((m) => `"${m}"`).join(', ')}.</p>
      )}
      {network && <p className="mt-1">{status.error.message}</p>}
      <p className="mt-2 text-rose-900">
        {savedData
          ? <>Still on file for this step: <b>{describeSaved(step, savedData)}</b>. Nothing else in the form was affected.</>
          : 'This step has not been saved yet.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {savedData && <Button size="sm" variant="secondary" onClick={onRevert} disabled={saving}>Undo my changes</Button>}
        <Button size="sm" variant="secondary" onClick={onRetry} disabled={saving}>{saving ? 'Saving…' : 'Try saving again'}</Button>
      </div>
    </div>
  );
}

function OnFile({ saved, statusOf }) {
  return (
    <aside aria-labelledby="on-file-title" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="on-file-title" className="font-bold">Saved on the server</h2>
      <p className="mt-1 text-xs text-muted">Every step saves automatically. This shows what the server has actually confirmed, not just what's typed in.</p>
      <dl className="mt-4 space-y-3">
        {STEPS.map((s) => (
          <div key={s.number} className="min-w-0">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              {s.number}. {s.title}
              {statusOf(s.number) === 'error' && <span className="rounded-full bg-rose-50 px-1.5 py-px text-[10px] text-rose-700 ring-1 ring-rose-200">rejected change</span>}
              {statusOf(s.number) === 'unsaved' && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] text-amber-800 ring-1 ring-amber-200">edits pending</span>}
            </dt>
            <dd className={`mt-0.5 break-words text-sm ${saved[s.number] ? 'text-ink' : 'text-muted'}`}>{describeSaved(s.number, saved[s.number])}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

export function SettingsPage({ accountId, search }) {
  const form = useSettingsForm(accountId);
  const { load, drafts, saved, serverErrors, saveStatus, submitState } = form;
  const reachable = furthestReachableStep(saved);
  const requested = stepFromSearch(search);
  const step = Math.min(requested, reachable);

  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const stepHeading = useRef(null);
  const errorPanel = useRef(null);
  const formRef = useRef(null);
  const pendingFocus = useRef(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const successHeading = useRef(null);

  // Focus is moved after the next render, once the target step/panel exists.
  // target: 'heading' | 'alert' | a field name
  const requestFocus = (target) => {
    pendingFocus.current = target;
    setFocusRequest((n) => n + 1);
  };

  // Someone deep-linked to a step they can't reach yet: fix the URL.
  useEffect(() => {
    if (load.status === 'ready' && requested !== step) {
      navigate(`/accounts/${accountId}/settings?step=${step}`, { replace: true });
    }
  }, [load.status, requested, step, accountId]);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    if (target === 'alert' && errorPanel.current) errorPanel.current.focus();
    else if (target === 'heading' || target === 'alert') stepHeading.current?.focus();
    else formRef.current?.querySelector(`[name="${target}"]`)?.focus();
  }, [focusRequest, step]);

  useEffect(() => {
    if (submitState.state === 'submitted') successHeading.current?.focus();
  }, [submitState.state]);

  // Warn before closing the tab with work that hasn't reached the server.
  const hasUnsaved = drafts && STEPS.some((s) => form.isDirty(s.number) || saveStatus[s.number]?.state === 'saving');
  useEffect(() => {
    if (!hasUnsaved) return undefined;
    const warn = (event) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  if (load.status === 'loading') {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
        <AccountHeader accountId={accountId} load={load} onRetry={form.retryAccount} />
        <div className="space-y-4 rounded-2xl border border-line bg-white p-6">
          <span className="sr-only" role="status">Loading saved settings…</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-5 w-48" />
          <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    const notFound = load.error?.status === 404;
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <AccountHeader accountId={accountId} load={load} onRetry={form.retryAccount} />
        <div className="rounded-2xl border border-line bg-white">
          {notFound ? (
            <ErrorState title="Account not found" message={`There's no account with id ${accountId}.`} />
          ) : (
            <ErrorState title="Couldn't load saved settings" message="We need them before you can edit, so nothing gets overwritten by accident." onRetry={form.reload} />
          )}
        </div>
        <Link href="/" className="inline-block text-sm font-semibold text-brand-700 underline underline-offset-4">Back to accounts</Link>
      </div>
    );
  }

  const statusOf = (n) => {
    if (serverErrors[n] || saveStatus[n]?.state === 'error') return 'error';
    if (saveStatus[n]?.state === 'saving') return 'saving';
    if (form.isDirty(n)) return saved[n] || attempted[n] ? 'unsaved' : 'todo';
    return saved[n] ? 'done' : 'todo';
  };

  const clientErrors = validateStep(step, drafts[step]);
  const errorFor = (field) => serverErrors[step]?.[field]
    ?? ((touched[step]?.[field] || attempted[step]) ? clientErrors[field] : undefined);

  const goTo = (target, focus = 'heading') => {
    setNotice('');
    navigate(`/accounts/${accountId}/settings?step=${target}`);
    requestFocus(focus);
  };

  // Leaving a step backwards or sideways: save what's valid in the background and go.
  // Any failure lands on that step's marker in the stepper.
  const selectStep = (target) => {
    if (target === step) return;
    form.save(step);
    goTo(target);
  };

  const failStep = (target, reason, missing) => {
    setAttempted((a) => ({ ...a, [target]: true }));
    if (reason === 'invalid') {
      const firstField = Object.keys(validateStep(target, drafts[target]))[0];
      setNotice(target === step ? '' : `Step ${target} needs fixing before you can submit.`);
      requestFocus(firstField);
    } else if (missing) {
      setNotice(`Step ${missing.join(', ')} ${missing.length > 1 ? "haven't" : "hasn't"} been saved yet. Complete ${missing.length > 1 ? 'them' : 'it'} to submit.`);
      requestFocus('heading');
    } else {
      requestFocus('alert');
    }
    if (target !== step) navigate(`/accounts/${accountId}/settings?step=${target}`);
  };

  const handleNext = async () => {
    if (Object.keys(clientErrors).length) {
      failStep(step, 'invalid');
      return;
    }
    setBusy(true);
    const result = await form.save(step);
    setBusy(false);
    if (result.ok) goTo(step + 1);
    else failStep(result.stepError?.step ?? step, 'save');
  };

  const handleSubmit = async () => {
    setBusy(true);
    const result = await form.submit();
    setBusy(false);
    if (!result.ok && result.step) failStep(result.step, result.reason, result.missing);
  };

  if (submitState.state === 'submitted') {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <AccountHeader accountId={accountId} load={load} onRetry={form.retryAccount} />
        <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
          <span className="grid size-10 place-items-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true">
            <svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <h2 ref={successHeading} tabIndex={-1} className="mt-4 text-xl font-bold focus:outline-none">Settings submitted</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {STEPS.map((s) => (
              <div key={s.number}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{s.title}</dt>
                <dd className="break-words text-sm">{describeSaved(s.number, saved[s.number])}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/" className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-soft">Back to accounts</Link>
            <Button onClick={form.resetSubmit}>Keep editing</Button>
          </div>
        </section>
      </div>
    );
  }

  const meta = STEPS[step - 1];
  const showErrorPanel = Boolean(serverErrors[step]) || saveStatus[step]?.state === 'error';
  const otherStepErrors = STEPS.filter((s) => s.number !== step && statusOf(s.number) === 'error');
  const isLast = step === 4;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AccountHeader accountId={accountId} load={load} onRetry={form.retryAccount} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="step-title" className="rounded-2xl border border-line bg-white">
          <div className="border-b border-line bg-canvas/60 p-2 sm:p-3">
            <Stepper current={step} statusOf={statusOf} reachable={reachable} onSelect={selectStep} />
          </div>

          <form
            ref={formRef}
            noValidate
            className="space-y-5 p-5 sm:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (isLast) handleSubmit();
              else handleNext();
            }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Step {step} of 4</p>
              <h2 id="step-title" ref={stepHeading} tabIndex={-1} className="mt-0.5 text-xl font-bold focus:outline-none">{meta.title}</h2>
              <p className="text-sm text-muted">{meta.description}</p>
            </div>

            {otherStepErrors.length > 0 && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                {otherStepErrors.map((s) => (
                  <span key={s.number} className="flex items-center gap-2">
                    Step {s.number} ({s.title}) has a change the server rejected.
                    <Button size="sm" onClick={() => goTo(s.number, 'alert')}>Go to step {s.number}</Button>
                  </span>
                ))}
              </div>
            )}
            {notice && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
            {submitState.state === 'error' && !submitState.error?.body?.detail?.missing_steps && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                Couldn't submit: {submitState.error?.message}
              </p>
            )}
            {showErrorPanel && (
              <SaveErrorPanel
                step={step}
                status={saveStatus[step]}
                serverErrors={serverErrors[step]}
                savedData={saved[step]}
                panelRef={errorPanel}
                onRevert={() => form.revert(step)}
                onRetry={() => form.save(step)}
              />
            )}

            <StepFields
              step={step}
              draft={drafts[step]}
              errorFor={errorFor}
              onChange={(field, value) => form.updateField(step, field, value)}
              onBlur={(field) => setTouched((t) => ({ ...t, [step]: { ...t[step], [field]: true } }))}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <SaveIndicator status={saveStatus[step]} dirty={form.isDirty(step) && Boolean(saved[step])} />
              <div className="flex flex-1 justify-end gap-2">
                {step > 1 && <Button onClick={() => selectStep(step - 1)}>Back</Button>}
                <Button type="submit" variant="primary" disabled={busy || submitState.state === 'submitting'}>
                  {(busy || submitState.state === 'submitting') && <Spinner className="size-4" />}
                  {isLast ? 'Submit settings' : 'Save and continue'}
                </Button>
              </div>
            </div>
          </form>
        </section>

        <OnFile saved={saved} statusOf={statusOf} />
      </div>
    </div>
  );
}
