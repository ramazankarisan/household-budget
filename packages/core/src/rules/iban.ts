import { normalizeIban } from './normalize.js';

/**
 * Whether a typed IBAN can be an account's: the ISO 13616 shape and its mod-97 check
 * digits. An account is chosen before its first import and every upload is checked
 * against it, so one mistyped digit would make an account that no file ever fits. The
 * checksum catches every single-digit typo and every swap of two neighbours; the
 * per-country length table would add little on top of it.
 */
export function isValidIban(value: string | null | undefined): boolean {
  const iban = normalizeIban(value).toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) {
    return false;
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    // A–Z count as 10–35; digits as themselves. Folded digit by digit, so no BigInt.
    const digits = /\d/u.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}
