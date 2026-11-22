import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export interface SwaggerPluginOptions {
  readonly enabled?: boolean;
}

export const swaggerPlugin = fp<SwaggerPluginOptions>(
  async function registerSwaggerPlugin(
    fastify: FastifyInstance,
    options: SwaggerPluginOptions,
  ) {
    if (options.enabled === false) {
      return;
    }

    await fastify.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Order & Inventory Reservation Service API',
          version: '1.0.0',
          description:
            'Transactional, deadlock-free order reservation service with crash-safe idempotency and append-only inventory ledger.',
        },
        tags: [
          { name: 'Health', description: 'Unversioned probes (/healthz, /readyz) and diagnostics (/api/health)' },
          { name: 'Inventory', description: 'SKU stock levels and audit ledger' },
          { name: 'Orders', description: 'Idempotent order reservation, lookup, and cancellation' },
        ],
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  },
  {
    name: 'ois-swagger-plugin',
  },
);
