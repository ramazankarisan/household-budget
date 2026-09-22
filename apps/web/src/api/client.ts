import { type HelloPayload } from '@household-budget/core';

/**
 * Requests go to a relative path: in dev the Vite proxy forwards /api to the
 * Nest server, in production the two are served from the same origin. No API
 * base URL to configure either way.
 */
export async function fetchHello(signal: AbortSignal): Promise<HelloPayload> {
  const response = await fetch('/api/hello', { signal });

  if (!response.ok) {
    throw new Error(`GET /api/hello failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as HelloPayload;
}
