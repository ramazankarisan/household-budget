import { BankFileEncoding } from '@household-budget/core';

export interface DecodedBankCsv {
  readonly text: string;
  readonly encoding: BankFileEncoding;
}

/**
 * Decodes an uploaded bank export.
 *
 * No charset detection library and no heuristics: UTF-8 is structurally
 * self-validating, so validating is enough. `Müller` in Windows-1252 is `… FC 6C …`,
 * and `0xFC` is not a legal UTF-8 lead byte at all; `Straße` is `… DF 65`, where
 * `0xDF` is a legal lead but `e` is not a continuation byte. The UTF-8 reading dies
 * immediately, and only then does the cp1252 fallback run.
 *
 * `windows-1252`, never `latin1`: they agree on every umlaut but diverge at
 * 0x80–0x9F, where cp1252 has `€`, curly quotes, en-dash and ellipsis — characters
 * that really do appear in a Verwendungszweck. Under `latin1` they become invisible
 * C1 control characters. `TextDecoder('windows-1252')` maps all 256 bytes and can
 * never throw, which makes it a safe terminal fallback.
 *
 * Lives in `apps/api` rather than `packages/core` because `TextDecoder` does not
 * typecheck under core's `"types": []`, and because `apps/web` bundles core.
 */
export function decodeBankCsv(bytes: Uint8Array): DecodedBankCsv {
  try {
    // TextDecoder strips a UTF-8 BOM; Buffer.toString('utf8') does not, and then the
    // first column name is U+FEFF glued to "Auftragskonto" and every row loses its
    // account number. This is a documented cause of "0 transactions imported".
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}
