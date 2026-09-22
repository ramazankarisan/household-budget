import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Paths are resolved from the working directory, which is apps/api for every
// `pnpm --filter @household-budget/api ...` script.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./data/budget.db',
  },
});
