/**
 * The one definition of "the same text" in this codebase.
 *
 * Extracted from `csv/fingerprint.ts`, where it was module-private, because
 * fingerprinting and rule matching have to agree: if a rule can tell two payee spellings
 * apart that the deduplicator considers identical, the same row is categorized
 * differently depending on which export it arrived in.
 *
 * Pure, and free of `Intl` and `Date` — `packages/core/tsconfig.json` sets `"types": []`
 * and `apps/web` bundles this module.
 */

/**
 * NFKC so that visually identical payee names from different exports agree — `Müller`
 * typed as U+00FC and as `u` + U+0308 are different byte sequences and the same name —
 * whitespace collapsed because a `Verwendungszweck` carries a CRLF the bank inserted and
 * is padded differently between exports, and lower-cased because case drift between
 * exports is a documented failure mode and `MÜLLER GmbH` is `Müller GmbH`.
 *
 * Lower-casing is the part SQLite cannot do: its `lower()` and `NOCASE` fold ASCII only,
 * which is why matching runs here rather than in a `WHERE` clause.
 */
export function normalize(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** An IBAN is the same IBAN whether or not the user typed it in groups of four. */
export function normalizeIban(value: string | null | undefined): string {
  return normalize(value).replaceAll(' ', '');
}
