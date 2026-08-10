export class KnackError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;

  constructor(message: string, opts: { status: number; body?: unknown; url: string }) {
    super(message);
    this.name = 'KnackError';
    this.status = opts.status;
    this.body = opts.body;
    this.url = opts.url;
  }

  /**
   * The session is gone or was never valid. Callers should clear stored
   * credentials and send the user back to login.
   *
   * Knack answers with 403 rather than 401 for an expired or missing user
   * token on a login-protected view, so both are treated as auth failures.
   */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Pull the most useful message Knack offers; its error shapes are inconsistent. */
export const knackErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    // { errors: [{ message }] } or { errors: ['...'] }
    if (Array.isArray(b.errors) && b.errors.length > 0) {
      const messages = b.errors
        .map((e) =>
          typeof e === 'string'
            ? e
            : ((e as Record<string, unknown>)?.message ??
               (e as Record<string, unknown>)?.field ??
               null),
        )
        .filter((m): m is string => typeof m === 'string' && m.length > 0);
      if (messages.length > 0) return messages.join('; ');
    }
    if (typeof b.message === 'string' && b.message) return b.message;
    if (typeof b.error === 'string' && b.error) return b.error;
  }
  return fallback;
};
