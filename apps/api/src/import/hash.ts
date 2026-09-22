import { hash } from 'node:crypto';

/** 128 bits: collision probability around 1e-29 at 100k rows, and half the column width. */
const DEDUP_KEY_LENGTH = 32;

/**
 * `crypto.hash` rather than `createHash`: roughly twice as fast for small inputs, and
 * there is one call per row. Available since Node 20.12 / 21.7; this repo requires 24.
 */
export function sha256Hex(input: string | Uint8Array): string {
  return hash('sha256', input, 'hex');
}

/** The stored `Transaction.dedupKey`. Truncated; the file hash keeps its full length. */
export function dedupKeyHash(input: string): string {
  return sha256Hex(input).slice(0, DEDUP_KEY_LENGTH);
}
