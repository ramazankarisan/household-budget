import { describe, expect, it } from 'vitest';

import { buildHelloPayload, describeHello } from './hello.js';

describe('buildHelloPayload', () => {
  it('uses the supplied clock for the timestamp', () => {
    const payload = buildHelloPayload({ db: 'ok', now: new Date('2026-01-02T03:04:05.000Z') });

    expect(payload).toEqual({
      message: 'hello from api',
      db: 'ok',
      timestamp: '2026-01-02T03:04:05.000Z',
    });
  });

  it('falls back to the current time when no clock is given', () => {
    const before = Date.now();
    const payload = buildHelloPayload({ db: 'unavailable' });
    const after = Date.now();

    const parsed = Date.parse(payload.timestamp);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe('describeHello', () => {
  it('distinguishes reachable from unavailable databases', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');

    expect(describeHello(buildHelloPayload({ db: 'ok', now: at }))).toBe(
      'hello from api — database reachable',
    );
    expect(describeHello(buildHelloPayload({ db: 'unavailable', now: at }))).toBe(
      'hello from api — database unavailable',
    );
  });
});
