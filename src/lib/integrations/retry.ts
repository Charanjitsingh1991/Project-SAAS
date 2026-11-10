/** Delay before the next attempt after attempt number `attempts` failed: 1m, 5m, 30m, 2h, 12h. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;
/** First attempt plus one retry per backoff step. */
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
/** Consecutive failed attempts after which an endpoint is switched off. */
export const AUTO_DISABLE_AFTER = 20;
export const TIMEOUT_MS = 10_000;
export const BODY_LIMIT = 500;

/** Milliseconds to wait before retrying, or null when attempts are exhausted. */
export function retryDelayMs(attemptsMade: number): number | null {
  if (attemptsMade < 1 || attemptsMade >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[attemptsMade - 1];
}

export const truncate = (s: string, n = BODY_LIMIT) => (s.length > n ? `${s.slice(0, n)}…` : s);
