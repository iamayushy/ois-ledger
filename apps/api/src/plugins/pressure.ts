import fp from 'fastify-plugin';
import underPressure from '@fastify/under-pressure';
import type { FastifyInstance } from 'fastify';
import { ERROR_CODE } from '@ois/shared/schemas';

export interface PressurePluginOptions {
  readonly enabled?: boolean;
}

export const pressurePlugin = fp<PressurePluginOptions>(
  async function registerPressurePlugin(
    fastify: FastifyInstance,
    options: PressurePluginOptions,
  ) {
    if (options.enabled === false) {
      return;
    }

    await fastify.register(underPressure, {
      maxEventLoopDelay: 1000,
      maxEventLoopUtilization: 0.98,
      maxHeapUsedBytes: 1_000_000_000,
      maxRssBytes: 1_500_000_000,
      retryAfter: 1,
      pressureHandler: (_request, reply) => {
        reply.code(503).send({
          error: {
            code: ERROR_CODE.SERVER_UNDER_PRESSURE,
            message: 'Server is currently under high load; please retry shortly',
          },
        });
      },
    });
  },
  {
    name: 'ois-pressure-plugin',
  },
);
