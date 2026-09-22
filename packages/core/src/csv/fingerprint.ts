/**
 * The content fingerprint a deduplication key is built from, and the discriminator
 * that keeps two genuinely identical purchases apart.
 *
 * Pure, and deliberately not hashing: `node:crypto` does not typecheck under core's
 * `"types": []`, and a core that imported it would break the `apps/web` bundle. Core
 * produces the canonical string; `apps/api` hashes it.
 */
import type { Transaction } from './transaction.js';

/**
 * NFKC so that visually identical payee names from different exports agree, whitespace
 * collapsed because a `Verwendungszweck` is padded differently between exports, and
 * lower-cased because case drift between exports is a documented failure mode.
 */
function normalize(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function normalizeIban(value: string | undefined): string {
  return normalize(value).replaceAll(' ', '');
}

/**
 * Canonical serialization of everything that makes a transaction itself.
 *
 * A fixed-order array, not an object: key order and the presence of optional keys then
 * cannot change the result, and no field's content can forge a separator. Two identical
 * same-day purchases at the same merchant collide here **by design** — telling them
 * apart is {@link assignOccurrences}'s job, not this function's.
 *
 * `'v1'` is the key-schema version. Changing how any field is normalized means bumping
 * it, which re-keys the stored rows from their preserved raw data rather than asking
 * the user to download every statement again.
 */
export function fingerprintInput(transaction: Transaction): string {
  return JSON.stringify([
    'v1',
    normalizeIban(transaction.accountIban),
    transaction.bookingDate,
    transaction.valueDate ?? '',
    // Integer cents, so "832,9" and "832,90" cannot fingerprint differently.
    String(transaction.amount),
    normalize(transaction.currency),
    normalize(transaction.counterpartyName),
    normalizeIban(transaction.counterpartyIban),
    normalize(transaction.purpose),
    normalize(transaction.bookingText),
    normalize(transaction.endToEndRef),
    normalize(transaction.mandateRef),
    normalize(transaction.creditorId),
  ]);
}

/**
 * The position of each row among the rows sharing its fingerprint, in file order.
 *
 * Deterministic and database-free: the same file always yields the same indices, so a
 * re-import produces the same keys and matches what is already stored, while an
 * overlapping export carrying one more identical row yields exactly one new index.
 * Rows with the same fingerprint are interchangeable by definition, so their relative
 * order cannot matter.
 *
 * This is per-fingerprint position, not absolute row position — the latter renumbers
 * whenever a new export starts at a different date, which is what makes every row look
 * new.
 */
export function assignOccurrences(fileFingerprints: readonly string[]): readonly number[] {
  const seen = new Map<string, number>();

  return fileFingerprints.map((fingerprint) => {
    const next = seen.get(fingerprint) ?? 0;
    seen.set(fingerprint, next + 1);
    return next;
  });
}

/**
 * What `apps/api` hashes into a `dedupKey`. Kept here so the fingerprint and its
 * discriminator are joined in one place rather than by a format string at the call site.
 */
export function dedupKeyInput(fingerprint: string, occurrence: number): string {
  return `${fingerprint}|n:${String(occurrence)}`;
}
