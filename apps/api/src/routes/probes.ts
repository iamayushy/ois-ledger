import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from '@ois/shared/schemas';
import { transientDbError } from '../errors.js';

export const LIVENESS_PATH = '/healthz';
export const READINESS_PATH = '/readyz';
export const PROBE_PATHS: ReadonlySet<string> = new Set([LIVENESS_PATH, READINESS_PATH]);

const READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('readiness check timed out')), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export const probeRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    LIVENESS_PATH,
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness: the process is up. No external dependencies are checked.',
        response: { 200: LivenessResponseSchema },
      },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: Math.floor(process.uptime()) }),
  );

  fastify.get(
    READINESS_PATH,
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness: PostgreSQL answers SELECT 1 within 2 seconds.',
        response: { 200: ReadinessResponseSchema, 503: ErrorResponseSchema },
      },
    },
    async () => {
      try {
        await withTimeout(fastify.pgPool.query('SELECT 1'), READINESS_TIMEOUT_MS);
      } catch {
        throw transientDbError('Database is not reachable; instance is not ready');
      }
      return { status: 'ready' as const, database: 'connected' as const };
    },
  );
};
