import { Logger } from '@nestjs/common';

import { sanitizeForLog } from './sanitize-log.js';

/**
 * What the guard reads and writes. Typed locally, like `UploadedCsv` in the import
 * controller, because `@types/express` is not installed in this app.
 */
interface GuardRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface GuardResponse {
  status(code: number): GuardResponse;
  json(body: unknown): unknown;
}

const logger = new Logger('LoopbackGuard');

/** `127.0.0.0/8` in the canonical dotted form `URL` normalizes every IPv4 spelling to. */
const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

/** `localhost`, anything in `127.0.0.0/8`, or `::1` with or without brackets. */
export function isLoopbackHost(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return name === 'localhost' || name === '::1' || name === '[::1]' || IPV4_LOOPBACK.test(name);
}

/**
 * The hostname part of a `Host` header, port and IPv6 brackets stripped. Parsed the same
 * way a browser parses an origin, so `localhost:3000@evil.com` is `evil.com`, not
 * `localhost`.
 */
function hostnameOf(host: string): string | undefined {
  return URL.parse(`http://${host}`)?.hostname.replace(/^\[(.*)\]$/u, '$1');
}

/**
 * True when the request can only have come from this machine's own UI: `Host` names a
 * loopback address — which a DNS-rebinding page cannot fake, its `Host` is its own domain —
 * and `Origin`, when a browser sent one, is a loopback page too, which a cross-site form
 * POST cannot fake.
 */
export function isLoopbackRequest(host: string | undefined, origin: string | undefined): boolean {
  if (host === undefined) return false;
  const hostname = hostnameOf(host);
  if (hostname === undefined || !isLoopbackHost(hostname)) return false;
  if (origin === undefined) return true;
  // `Origin: null` (sandboxed iframe, file://) is not a place this UI is served from.
  const url = URL.parse(origin);
  return url !== null && isLoopbackHost(url.hostname);
}

function header(req: GuardRequest, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Express-style middleware, registered with `app.use` in main.ts so it runs before routing
 * and for every path, 404s included. The API has no auth because it is local (CLAUDE.md →
 * WHY); this is what keeps "local" true for a browser tab on another site.
 */
export function loopbackGuard(req: GuardRequest, res: GuardResponse, next: () => void): void {
  const host = header(req, 'host');
  const origin = header(req, 'origin');
  if (isLoopbackRequest(host, origin)) {
    next();
    return;
  }

  // Debug, not warn: a rebinding page can send these in a loop, and a line per request at
  // a visible level would flood the log.
  logger.debug(
    `rejected host="${sanitizeForLog(host ?? '(none)')}" origin="${sanitizeForLog(origin ?? '(none)')}"`,
  );
  res.status(403).json({ statusCode: 403, code: 'FORBIDDEN_ORIGIN' });
}
