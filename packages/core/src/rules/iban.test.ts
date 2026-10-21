import { describe, expect, it } from 'vitest';

import { isValidIban } from './iban.js';

describe('isValidIban', () => {
  it.each([
    'DE89370400440532013000',
    'DE89 3704 0044 0532 0130 00',
    'de89370400440532013000',
    'GB82WEST12345698765432',
    'NL91ABNA0417164300',
  ])('accepts %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it.each([
    ['one digit typed wrong', 'DE89370400440532013001'],
    ['two neighbours swapped', 'DE89370400440532010300'],
    ['check digits wrong', 'DE88370400440532013000'],
    ['too short', 'DE8937040044'],
    ['no country code', '89370400440532013000'],
    ['a stray character', 'DE89-370400440532013000'],
    ['empty', ''],
    ['missing', null],
  ])('rejects %s', (_, iban) => {
    expect(isValidIban(iban)).toBe(false);
  });
});
