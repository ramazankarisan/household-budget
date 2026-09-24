import { describe, expect, it } from 'vitest';

import { sanitizeForLog } from './sanitize-log.js';

describe('sanitizeForLog', () => {
  it('escapes CR and LF, so a value cannot forge a second log line', () => {
    expect(sanitizeForLog('evil\r\n[Nest] fake line.csv')).toBe(
      'evil\\u000d\\u000a[Nest] fake line.csv',
    );
  });

  it('escapes ESC, C1 controls, DEL and the Unicode line separators', () => {
    expect(sanitizeForLog('\u001b[31mred')).toBe('\\u001b[31mred');
    expect(sanitizeForLog('a\u0085b\u007fc')).toBe('a\\u0085b\\u007fc');
    expect(sanitizeForLog('a\u2028b\u2029c')).toBe('a\\u2028b\\u2029c');
  });

  it('leaves umlauts and the euro sign alone', () => {
    expect(sanitizeForLog('Müller GmbH, Straße 12, 5 €')).toBe('Müller GmbH, Straße 12, 5 €');
  });

  it('caps long input at maxLength plus an ellipsis', () => {
    expect(sanitizeForLog('x'.repeat(500))).toBe(`${'x'.repeat(200)}…`);
    expect(sanitizeForLog('abcdef', 3)).toBe('abc…');
    expect(sanitizeForLog('abc', 3)).toBe('abc');
  });
});
