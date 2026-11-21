import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import { getPoolStats } from '@ois/db/client';
import { ErrorResponseSchema, HealthResponseSchema } from '@ois/shared/schemas';

export const healthRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Check API and PostgreSQL connection pool health',
        response: {
          200: HealthResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async () => {
      const start = process.hrtime.bigint();
      await fastify.db.execute(sql`SELECT 1`);
      const elapsedNs = process.hrtime.bigint() - start;
      const dbLatencyMs = Number((Number(elapsedNs) / 1_000_000).toFixed(2));

      return {
        status: 'ok' as const,
        database: 'connected' as const,
        dbLatencyMs,
        pool: getPoolStats(fastify.pgPool),
        timestamp: new Date().toISOString(),
      };
    },
  );
};
