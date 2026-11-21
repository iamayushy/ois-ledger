import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createDbClient } from './client.js';
import { seedDatabase } from './seed-data.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(CURRENT_DIR, '../../../.env') });

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  const client = createDbClient({ connectionString: databaseUrl, max: 2 });
  try {
    const result = await seedDatabase(client.db);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await client.close();
  }
}

await main();
