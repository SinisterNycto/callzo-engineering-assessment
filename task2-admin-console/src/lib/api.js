// Thin fetch wrapper for the mock API. The app always calls a same-origin
// /api prefix; nginx (in Docker) or Vite (in dev) proxies it to the mock API,
// so the browser never needs to know the mock API's hostname.

const BASE = '/api';

export class ApiError extends Error {
  constructor(status, body, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 means the request never got a response
    this.body = body;
  }
}

function messageFor(status, body) {
  if (typeof body?.detail === 'string') return body.detail;
  if (status === 404) return 'Not found.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (${status}).`;
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, null, "Couldn't reach the server. Check your connection.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data, messageFor(response.status, data));
  return data;
}

export const api = {
  health: (signal) => request('/health', { signal }),
  listAccounts: (params, signal) => request(`/accounts?${params}`, { signal }),
  getAccount: (id, signal) => request(`/accounts/${id}`, { signal }),
  getSummary: (params, signal) => request(`/accounts/summary?${params}`, { signal }),
  getSettings: (id, signal) => request(`/accounts/${id}/settings`, { signal }),
  saveStep: (id, step, data) => request(`/accounts/${id}/settings/step/${step}`, { method: 'PUT', body: { data } }),
  submitSettings: (id) => request(`/accounts/${id}/settings/submit`, { method: 'POST' }),
};
