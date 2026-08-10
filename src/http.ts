import { KnackError, knackErrorMessage } from './errors.js';
import { getLimiter, sleep } from './limiter.js';

/** Transient statuses worth retrying. 403 is included because Knack uses it
 *  for throttling as well as for authorization — see the guard below. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

export interface HttpContext {
  appId: string;
  rps?: number;
  /** Called when a request fails with 401/403 so the app can drop the session. */
  onAuthError?: (error: KnackError) => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** Set for multipart uploads, where the body must not be JSON-encoded. */
  rawBody?: BodyInit;
}

const retryDelayMs = (response: Response, attempt: number): number => {
  // Knack sends Retry-After on 429...
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000 + 50;
  }
  // ...and an epoch-seconds reset header, which is more precise when present.
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset) {
    const resetEpochSec = Number(reset);
    if (Number.isFinite(resetEpochSec)) {
      const waitMs = resetEpochSec * 1000 - Date.now() + 50;
      if (waitMs > 0) return waitMs;
    }
  }
  return 2 ** attempt * 1000;
};

const parseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const request = async <T>(
  url: string,
  ctx: HttpContext,
  options: RequestOptions,
): Promise<T> => {
  const limiter = getLimiter(ctx.appId, ctx.rps);
  let lastError: KnackError | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    await limiter.acquire();

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body:
          options.rawBody ??
          (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: options.signal,
      });
    } catch (cause) {
      // Network failure or abort. Aborts must propagate untouched so callers
      // (and TanStack Query) can distinguish cancellation from failure.
      if (options.signal?.aborted) throw cause;
      if (attempt > MAX_RETRIES) {
        throw new KnackError(`Network error calling Knack: ${String(cause)}`, {
          status: 0,
          url,
        });
      }
      await sleep(2 ** attempt * 1000);
      continue;
    }

    if (response.ok) return (await parseBody(response)) as T;

    const body = await parseBody(response);
    const error = new KnackError(
      knackErrorMessage(body, `Knack request failed: ${response.status} ${response.statusText}`),
      { status: response.status, body, url },
    );

    // A 403 with no rate-limit headers is an authorization failure, not
    // throttling — retrying it just delays the redirect to login.
    const isThrottled403 =
      response.status === 403 &&
      (response.headers.has('retry-after') || response.headers.has('x-ratelimit-reset'));

    if (error.isAuthError && !isThrottled403) {
      ctx.onAuthError?.(error);
      throw error;
    }

    if (attempt > MAX_RETRIES || !(RETRY_STATUSES.has(response.status) || isThrottled403)) {
      throw error;
    }

    lastError = error;
    await sleep(retryDelayMs(response, attempt));
  }

  throw lastError ?? new KnackError('Knack request failed', { status: 0, url });
};

export const buildQuery = (params: Record<string, string | number | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};
