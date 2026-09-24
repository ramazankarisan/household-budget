import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { loopbackGuard } from './security/loopback.js';

const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;
/**
 * Loopback only. The app is local by design (CLAUDE.md → WHY) and has no auth, so it must
 * not be reachable from another device on the network. The Vite proxy targets 127.0.0.1.
 */
const LISTEN_HOST = '127.0.0.1';

/**
 * A copied .env often carries `PORT=`, and `Number('')` is 0, which makes Nest
 * bind a random ephemeral port that the web dev-server proxy cannot reach.
 * Treat a blank value as unset and reject anything that is not a port number.
 */
function resolvePort(): number {
  const raw = process.env['PORT']?.trim();
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 0 and ${MAX_PORT}.`);
  }
  return port;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Before the prefix and every route, so it covers 404s too. No CORS: the web dev server
  // proxies /api, and nothing on another origin has any business reading this API.
  app.use(loopbackGuard);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = resolvePort();
  await app.listen(port, LISTEN_HOST);

  Logger.log(`API listening on http://${LISTEN_HOST}:${port}/api`, 'Bootstrap');
}

void bootstrap();
