/**
 * Sliding-window rate limiter, shared per application ID.
 *
 * Knack allows roughly 10 requests/second per application. We default to 8 to
 * leave headroom for anything else hitting the same app (webhooks, the
 * Builder, a colleague's tab).
 *
 * The registry is keyed by app ID and module-level, so every client instance
 * on the page shares one budget rather than each believing it has the whole
 * allowance — the bug that made concurrent clients 429 in earlier versions of
 * this code across the estate.
 */

const WINDOW_MS = 1000;
const DEFAULT_RPS = 8;

class SlidingWindowLimiter {
  private readonly timestamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly rps: number) {}

  /**
   * Resolves when it is this caller's turn. Calls are serialized so that
   * concurrent acquirers can't all observe the same free slot and pile in.
   */
  acquire(): Promise<void> {
    const next = this.chain.then(() => this.wait());
    // Keep the chain alive even if a waiter is abandoned.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async wait(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.timestamps.length > 0 && now - this.timestamps[0]! >= WINDOW_MS) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.rps) {
        this.timestamps.push(Date.now());
        return;
      }
      const waitMs = WINDOW_MS - (now - this.timestamps[0]!) + 1;
      await sleep(waitMs);
    }
  }
}

const registry = new Map<string, SlidingWindowLimiter>();

export const getLimiter = (appId: string, rps: number = DEFAULT_RPS): SlidingWindowLimiter => {
  let limiter = registry.get(appId);
  if (!limiter) {
    limiter = new SlidingWindowLimiter(rps);
    registry.set(appId, limiter);
  }
  return limiter;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
