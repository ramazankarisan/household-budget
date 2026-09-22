import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodeBankCsv } from './decode.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(fixtures, name)));

describe('the fixtures themselves', () => {
  it('keeps sparkasse-camt-18.csv in Windows-1252', () => {
    // The durable version of the byte check: .editorconfig and .gitattributes are meant
    // to stop an editor re-encoding this file, and this fails if one ever does. 0xFC is
    // cp1252 'ü'; 0xC3 0xBC is the UTF-8 encoding of the same character.
    const bytes = readFileSync(resolve(fixtures, 'sparkasse-camt-18.csv'));

    expect(bytes.includes(0xfc)).toBe(true);
    expect(bytes.includes(Buffer.from([0xc3, 0xbc]))).toBe(false);
  });

  it('keeps the UTF-8 twin byte-identical to the cp1252 original once decoded', () => {
    const cp1252 = decodeBankCsv(bytesOf('sparkasse-camt-18.csv'));
    const utf8 = decodeBankCsv(bytesOf('sparkasse-camt-18-utf8.csv'));

    expect(cp1252.text).toBe(utf8.text);
  });

  it('keeps CRLF line endings', () => {
    const { text } = decodeBankCsv(bytesOf('sparkasse-camt-18.csv'));

    expect(text).toContain('\r\n');
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
  });
});

describe('decodeBankCsv', () => {
  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    const { text, encoding } = decodeBankCsv(bytesOf('sparkasse-camt-18.csv'));

    expect(encoding).toBe('windows-1252');
    expect(text).toContain('Müller GmbH');
    expect(text).toContain('Gebühr');
    expect(text).toContain('Hauptstraße 12');
  });

  it('decodes UTF-8 as UTF-8', () => {
    const { text, encoding } = decodeBankCsv(bytesOf('sparkasse-camt-18-utf8.csv'));

    expect(encoding).toBe('utf-8');
    expect(text).toContain('Müller GmbH');
  });

  it('strips a UTF-8 BOM', () => {
    // Skipping this leaves the first header key as U+FEFF + "Auftragskonto", and every
    // row then reads as missing its own account number.
    const { text, encoding } = decodeBankCsv(bytesOf('sparkasse-camt-18-utf8-bom.csv'));

    expect(encoding).toBe('utf-8');
    expect(text.startsWith('Auftragskonto')).toBe(true);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('never produces mojibake in either direction', () => {
    const cp1252 = decodeBankCsv(bytesOf('sparkasse-camt-18.csv')).text;
    const utf8 = decodeBankCsv(bytesOf('sparkasse-camt-18-utf8.csv')).text;

    // cp1252 bytes read as UTF-8 give U+FFFD; UTF-8 bytes read as cp1252 give Ã¼.
    expect(cp1252).not.toContain('�');
    expect(cp1252).not.toContain('Ã¼');
    expect(utf8).not.toContain('�');
    expect(utf8).not.toContain('Ã¼');
  });
});
