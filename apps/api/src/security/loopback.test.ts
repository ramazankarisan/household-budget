import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isLoopbackHost, isLoopbackRequest, loopbackGuard } from './loopback.js';

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.2', '127.255.255.255', '::1', '[::1]'])(
    'accepts %s',
    (hostname) => {
      expect(isLoopbackHost(hostname)).toBe(true);
    },
  );

  it.each(['evil.com', '192.168.1.10', 'localhost.evil.com', '127.0.0.1.nip.io', '0.0.0.0', ''])(
    'rejects %s',
    (hostname) => {
      expect(isLoopbackHost(hostname)).toBe(false);
    },
  );
});

describe('isLoopbackRequest', () => {
  it.each(['127.0.0.1:3000', 'localhost:3000', '[::1]:3000', '127.0.0.2:3000', 'localhost'])(
    'accepts Host %s with no Origin',
    (host) => {
      expect(isLoopbackRequest(host, undefined)).toBe(true);
    },
  );

  it.each(['http://localhost:5173', 'http://127.0.0.1:5174', 'http://[::1]:5173'])(
    'accepts a loopback Host with Origin %s',
    (origin) => {
      expect(isLoopbackRequest('127.0.0.1:3000', origin)).toBe(true);
    },
  );

  it.each([
    'evil.com:3000',
    '192.168.1.10:3000',
    'localhost.evil.com',
    '127.0.0.1.nip.io:3000',
    'localhost:3000@evil.com',
    '',
  ])('rejects Host %s', (host) => {
    expect(isLoopbackRequest(host, undefined)).toBe(false);
  });

  it('rejects a missing Host', () => {
    expect(isLoopbackRequest(undefined, undefined)).toBe(false);
  });

  it.each(['https://evil.com', 'null', 'http://localhost.evil.com', 'not a url', ''])(
    'rejects Origin %s even with a loopback Host',
    (origin) => {
      expect(isLoopbackRequest('127.0.0.1:3000', origin)).toBe(false);
    },
  );
});

describe('loopbackGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function response() {
    const res = {
      status: vi.fn(() => res),
      json: vi.fn(),
    };
    return res;
  }

  it('calls next() for a loopback request', () => {
    const res = response();
    const next = vi.fn();

    loopbackGuard(
      { headers: { host: '127.0.0.1:3000', origin: 'http://localhost:5173' } },
      res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 403 FORBIDDEN_ORIGIN and stops the chain otherwise', () => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const res = response();
    const next = vi.fn();

    loopbackGuard({ headers: { host: '127.0.0.1:3000', origin: 'https://evil.com' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 403, code: 'FORBIDDEN_ORIGIN' });
  });

  it('logs rejections at debug, not warn, with the headers escaped', () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    loopbackGuard({ headers: { host: 'evil.com:3000\n[Nest] fake' } }, response(), vi.fn());

    expect(debug).toHaveBeenCalledWith(
      'rejected host="evil.com:3000\\u000a[Nest] fake" origin="(none)"',
    );
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
