// Retry an async call on server errors (5xx) and network failures only.
// 4xx means the request itself is wrong; sending it again won't help.

export function isRetryable(error) {
  if (error?.name === 'AbortError') return false;
  return error?.status === 0 || error?.status >= 500;
}

export async function withRetry(fn, { delays = [400, 1200], signal, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= delays.length || !isRetryable(error) || signal?.aborted) throw error;
      await wait(delays[attempt], signal);
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
