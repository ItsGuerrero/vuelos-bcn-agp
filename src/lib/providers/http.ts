/** fetch con timeout, reintentos y espera exponencial (con jitter). */

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} en ${redact(url)}: ${body.slice(0, 200)}`);
  }
}

export interface FetchJsonOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Oculta claves de API en los mensajes de error. */
export function redact(url: string): string {
  return url.replace(/(api_key=)[^&]+/i, "$1***");
}

function isRetryable(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 800;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await doFetch(url, { headers: opts.headers, signal: ctrl.signal, cache: "no-store" });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, url, text);
        if (!isRetryable(res.status)) throw err;
        lastErr = err;
      } else {
        return JSON.parse(text) as T;
      }
    } catch (e) {
      if (e instanceof HttpError && !isRetryable(e.status)) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(base * 2 ** attempt + Math.random() * 250);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
