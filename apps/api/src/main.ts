import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

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

  app.setGlobalPrefix('api');
  // The web dev server proxies /api, so CORS is not needed for it. This is
  // here for direct browser calls to :3000 while debugging.
  app.enableCors({ origin: true });
  app.enableShutdownHooks();

  const port = resolvePort();
  await app.listen(port);

  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
