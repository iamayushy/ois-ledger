import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { runMigrations } from './migrate.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(CURRENT_DIR, '../../../.env') });

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  await runMigrations(databaseUrl);

  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  if (testDatabaseUrl && testDatabaseUrl !== databaseUrl) {
    await runMigrations(testDatabaseUrl);
  }
}

await main();
