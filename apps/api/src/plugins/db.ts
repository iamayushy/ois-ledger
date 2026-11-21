import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createDbClient, type DbClient, type OisDatabase } from '@ois/db/client';

declare module 'fastify' {
  interface FastifyInstance {
    readonly db: OisDatabase;
    readonly pgPool: Pool;
  }
}

export interface DbPluginOptions {
  readonly connectionString?: string;
  readonly dbClient?: DbClient;
  readonly max?: number;
  readonly idleTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
}

export const dbPlugin = fp<DbPluginOptions>(
  async function registerDbPlugin(fastify: FastifyInstance, options: DbPluginOptions) {
    const ownedClient = options.dbClient
      ? null
      : createDbClient({
          connectionString: options.connectionString ?? '',
          ...(options.max !== undefined ? { max: options.max } : {}),
          ...(options.idleTimeoutMs !== undefined
            ? { idleTimeoutMs: options.idleTimeoutMs }
            : {}),
          ...(options.connectionTimeoutMs !== undefined
            ? { connectionTimeoutMs: options.connectionTimeoutMs }
            : {}),
        });

    const activeClient = options.dbClient ?? ownedClient;
    if (!activeClient) {
      throw new Error('Either dbClient or connectionString must be provided to dbPlugin');
    }

    fastify.decorate('db', activeClient.db);
    fastify.decorate('pgPool', activeClient.pool);

    if (ownedClient) {
      fastify.addHook('onClose', async () => {
        await ownedClient.close();
      });
    }
  },
  {
    name: 'ois-db-plugin',
  },
);
