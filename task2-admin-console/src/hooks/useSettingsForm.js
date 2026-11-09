// State for the 4-step settings form.
//
// Two copies of each step are kept:
//   saved[step]  what the server has confirmed (from GET or a successful PUT)
//   drafts[step] what is in the inputs right now
// The UI only ever shows a step as saved when the server said so. If a save
// fails, `saved` doesn't change, so that state rolls back by construction. The
// user's typing stays in the draft (we never throw away input), and
// revert(step) puts the draft back to the saved values.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import {
  STEP_NUMBERS, initialDrafts, normaliseSaved, parseMissingSteps, parseStepError,
  samePayload, toDraft, toPayload, validateStep,
} from '../lib/settingsForm.js';

const AUTOSAVE_DELAY_MS = 800;

// useState plus a ref that always holds the latest value, so async save
// handlers read current data instead of whatever their closure captured.
function useStateWithRef(initial) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((update) => {
    ref.current = typeof update === 'function' ? update(ref.current) : update;
    setState(ref.current);
  }, []);
  return [state, set, ref];
}

const withoutKey = (obj, key) => {
  const { [key]: _removed, ...rest } = obj;
  return rest;
};

export function useSettingsForm(accountId) {
  const [load, setLoad] = useState({ status: 'loading', error: null, account: null, accountError: null });
  const [reloadToken, setReloadToken] = useState(0);
  const [saved, setSaved, savedRef] = useStateWithRef({});
  const [drafts, setDrafts, draftsRef] = useStateWithRef(null);
  const [serverErrors, setServerErrors] = useState({});
  const [saveStatus, setSaveStatus] = useState({}); // step -> { state: saving|saved|error, error, at }
  const [submitState, setSubmitState] = useState({ state: 'idle', error: null });
  const requestSeq = useRef({});
  const autosaveTimers = useRef({});

  useEffect(() => {
    const controller = new AbortController();
    setLoad((l) => ({ ...l, status: 'loading', error: null }));

    Promise.allSettled([
      api.getSettings(accountId, controller.signal),
      api.getAccount(accountId, controller.signal),
    ]).then(([settingsResult, accountResult]) => {
      if (controller.signal.aborted) return;
      const account = accountResult.status === 'fulfilled' ? accountResult.value : null;
      const accountError = accountResult.status === 'rejected' ? accountResult.reason : null;

      // Without the saved settings we can't safely edit (we might overwrite a
      // draft we didn't load), so that failure blocks the form. A failed
      // account lookup only costs us the header and prefill.
      if (settingsResult.status === 'rejected') {
        setLoad({ status: 'error', error: settingsResult.reason, account, accountError });
        return;
      }
      const serverSaved = normaliseSaved(settingsResult.value);
      setSaved(serverSaved);
      setDrafts(initialDrafts(serverSaved, account));
      setLoad({ status: 'ready', error: null, account, accountError });
    });

    return () => controller.abort();
  }, [accountId, reloadToken, setSaved, setDrafts]);

  const save = useCallback(async (step) => {
    clearTimeout(autosaveTimers.current[step]);
    delete autosaveTimers.current[step];
    const draft = draftsRef.current?.[step];
    if (!draft || Object.keys(validateStep(step, draft)).length) return { ok: false, reason: 'invalid' };

    const payload = toPayload(step, draft);
    if (samePayload(payload, savedRef.current[step])) {
      setServerErrors((e) => withoutKey(e, step));
      setSaveStatus((s) => (s[step]?.state === 'error' ? withoutKey(s, step) : s));
      return { ok: true };
    }
    // Steps are saved strictly in order. The API locks step 2 once step 4
    // exists, so saving 4 before 2 would leave the account stuck for good.
    if (step > 1 && !savedRef.current[step - 1]) return { ok: false, reason: 'previous-step-unsaved' };

    const seq = (requestSeq.current[step] ?? 0) + 1;
    requestSeq.current[step] = seq;
    setSaveStatus((s) => ({ ...s, [step]: { state: 'saving' } }));

    try {
      const response = await api.saveStep(accountId, step, payload);
      if (requestSeq.current[step] !== seq) return { ok: true }; // a newer save superseded this one
      setSaved((s) => ({ ...s, [step]: response.data ?? payload }));
      setServerErrors((e) => withoutKey(e, step));
      setSaveStatus((s) => ({ ...s, [step]: { state: 'saved', at: Date.now() } }));
      return { ok: true };
    } catch (error) {
      if (requestSeq.current[step] !== seq) return { ok: false, reason: 'superseded' };
      const stepError = parseStepError(error);
      if (stepError) setServerErrors((e) => ({ ...e, [stepError.step]: stepError.errors }));
      setSaveStatus((s) => ({ ...s, [step]: { state: 'error', error } }));
      return { ok: false, reason: 'server', stepError };
    }
  }, [accountId, draftsRef, savedRef, setSaved]);

  const updateField = useCallback((step, field, value) => {
    setDrafts((d) => ({ ...d, [step]: { ...d[step], [field]: value } }));
    clearTimeout(autosaveTimers.current[step]);
    autosaveTimers.current[step] = setTimeout(() => save(step), AUTOSAVE_DELAY_MS);
  }, [save, setDrafts]);

  // Leaving the page (e.g. "Back to accounts") shouldn't drop a save that was
  // still waiting out its debounce, so flush those instead of cancelling them.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const timers = autosaveTimers.current;
    return () => Object.keys(timers).forEach((step) => saveRef.current(Number(step)));
  }, []);

  const revert = useCallback((step) => {
    clearTimeout(autosaveTimers.current[step]);
    delete autosaveTimers.current[step];
    setDrafts((d) => ({ ...d, [step]: toDraft(step, savedRef.current[step]) }));
    setServerErrors((e) => withoutKey(e, step));
    setSaveStatus((s) => withoutKey(s, step));
  }, [savedRef, setDrafts]);

  // Save every step that needs it, in order, then finalise. Returns where to
  // send the user if something is wrong.
  const submit = useCallback(async () => {
    for (const step of STEP_NUMBERS) {
      if (Object.keys(validateStep(step, draftsRef.current[step])).length) {
        return { ok: false, step, reason: 'invalid' };
      }
      const result = await save(step);
      if (!result.ok) return { ok: false, step: result.stepError?.step ?? step, reason: 'save' };
    }

    setSubmitState({ state: 'submitting', error: null });
    try {
      await api.submitSettings(accountId);
      setSubmitState({ state: 'submitted', error: null });
      return { ok: true };
    } catch (error) {
      setSubmitState({ state: 'error', error });
      const missing = parseMissingSteps(error);
      return { ok: false, step: missing?.[0], reason: 'submit', missing };
    }
  }, [accountId, draftsRef, save]);

  const isDirty = useCallback(
    (step) => Boolean(drafts) && !samePayload(toPayload(step, drafts[step]), saved[step]),
    [drafts, saved],
  );

  // Retry just the account lookup, without touching anything the user typed.
  const retryAccount = useCallback(async () => {
    setLoad((l) => ({ ...l, accountError: null }));
    try {
      const account = await api.getAccount(accountId);
      setLoad((l) => ({ ...l, account }));
    } catch (accountError) {
      setLoad((l) => ({ ...l, accountError }));
    }
  }, [accountId]);

  const resetSubmit = useCallback(() => setSubmitState({ state: 'idle', error: null }), []);

  return {
    load,
    reload: () => setReloadToken((t) => t + 1),
    retryAccount,
    resetSubmit,
    saved,
    drafts,
    serverErrors,
    saveStatus,
    submitState,
    updateField,
    save,
    revert,
    submit,
    isDirty,
  };
}
