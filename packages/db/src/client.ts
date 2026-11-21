import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PoolStatsDto } from '@ois/shared/schemas';
import { dbSchema, type DbSchema } from './schema.js';

export type OisDatabase = NodePgDatabase<DbSchema>;

export interface DbClientOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly idleTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
}

export interface DbClient {
  readonly pool: Pool;
  readonly db: OisDatabase;
  readonly close: () => Promise<void>;
}

const SESSION_TIMEOUT_OPTIONS =
  '-c idle_in_transaction_session_timeout=15000 -c lock_timeout=5000 -c statement_timeout=10000';

export function createDbClient(options: DbClientOptions): DbClient {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 20,
    idleTimeoutMillis: options.idleTimeoutMs ?? 20000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5000,
    options: SESSION_TIMEOUT_OPTIONS,
  });

  const db = drizzle(pool, { schema: dbSchema });

  return {
    pool,
    db,
    close: async () => {
      await pool.end();
    },
  };
}

const POOL_ACQUIRE_TIMEOUT_MESSAGES: readonly string[] = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
];

export function isPoolAcquireTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if (
      'message' in current &&
      typeof current.message === 'string' &&
      POOL_ACQUIRE_TIMEOUT_MESSAGES.includes(current.message)
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}

export function getPoolStats(pool: Pool): PoolStatsDto {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
