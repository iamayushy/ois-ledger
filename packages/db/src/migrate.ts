import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDbClient } from './client.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = resolve(CURRENT_DIR, '../drizzle');

export async function runMigrations(connectionString: string): Promise<void> {
  const client = createDbClient({
    connectionString,
    max: 1,
  });

  try {
    await migrate(client.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.close();
  }
}
