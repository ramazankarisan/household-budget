import 'dotenv/config';
import { defineConfig } from 'prisma/config';

import { resolveDatabaseUrl } from './src/config/database.js';

// Schema paths are resolved from the working directory, which is apps/api for
// every `pnpm --filter @household-budget/api ...` script. The database url is
// not: it comes from src/config/database.ts, the same source PrismaService
// uses, so the CLI and the running API never point at different files.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
