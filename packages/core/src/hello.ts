/**
 * Skeleton-only module. It exists to prove that both apps can import shared
 * domain code from @household-budget/core, and will be deleted once real
 * domain modules (CSV parsing, categorization, budget math) land here.
 */

/** Outcome of the API's database connectivity probe. */
export type DbStatus = 'ok' | 'unavailable';

/** Response body of `GET /api/hello`. The contract shared by apps/api and apps/web. */
export interface HelloPayload {
  readonly message: string;
  readonly db: DbStatus;
  readonly timestamp: string;
}

export interface BuildHelloPayloadOptions {
  readonly db: DbStatus;
  /** Injectable clock so callers — and tests — control the timestamp. */
  readonly now?: Date;
}

/** Builds the hello payload. Pure: no I/O, no ambient clock unless you omit `now`. */
export function buildHelloPayload({
  db,
  now = new Date(),
}: BuildHelloPayloadOptions): HelloPayload {
  return {
    message: 'hello from api',
    db,
    timestamp: now.toISOString(),
  };
}

/** Renders a payload as a single human-readable line. Used by the web app. */
export function describeHello(payload: HelloPayload): string {
  const db = payload.db === 'ok' ? 'database reachable' : 'database unavailable';
  return `${payload.message} — ${db}`;
}
