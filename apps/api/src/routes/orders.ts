import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ERROR_CODE,
  CancelOrderResponseSchema,
  CreateOrderBodySchema,
  CreateOrderHeadersSchema,
  CreateOrderResponseSchema,
  ErrorResponseSchema,
  IdempotencyKeyParamsSchema,
  ListOrdersQuerySchema,
  ListOrdersResponseSchema,
  OrderDetailDtoSchema,
  OrderIdParamsSchema,
} from '@ois/shared/schemas';
import {
  cancelOrder,
  createOrder,
  getOrderDetailById,
  getOrderDetailByIdempotencyKey,
  listOrders,
} from '../services/order-service.js';
import { isAppError } from '../errors.js';

const REJECTION_CODES: ReadonlySet<number> = new Set([
  ERROR_CODE.UNKNOWN_SKU,
  ERROR_CODE.INSUFFICIENT_STOCK,
  ERROR_CODE.IDEMPOTENCY_CONFLICT,
]);

export const orderRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    '/orders',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Create an all-or-nothing reservation with idempotency key',
        headers: CreateOrderHeadersSchema,
        body: CreateOrderBodySchema,
        response: {
          200: CreateOrderResponseSchema,
          201: CreateOrderResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKeyHeader = request.headers['idempotency-key'];
      const result = await createOrder(fastify.db, idempotencyKeyHeader, request.body).catch(
        (error: unknown) => {
          if (isAppError(error) && REJECTION_CODES.has(error.code)) {
            request.log.info(
              {
                event: 'reservation.rejected',
                idempotencyKey: idempotencyKeyHeader,
                customerId: request.body.customerId,
                errorCode: error.code,
                skus: request.body.items.map((item) => item.sku),
                shortages: error.details?.shortages,
                missingSkus: error.details?.missingSkus,
              },
              'Reservation rejected',
            );
          }
          throw error;
        },
      );

      request.log.info(
        {
          orderId: result.order.id,
          idempotencyKey: result.order.idempotencyKey,
          replayed: result.replayed,
        },
        result.replayed ? 'Order replayed from idempotency key' : 'Order reserved',
      );

      reply.header('Idempotency-Replayed', result.replayed ? 'true' : 'false');
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  fastify.get(
    '/orders',
    {
      schema: {
        tags: ['Orders'],
        summary: 'List orders with cursor pagination and filters',
        querystring: ListOrdersQuerySchema,
        response: {
          200: ListOrdersResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      return listOrders(fastify.db, request.query);
    },
  );

  fastify.get(
    '/orders/by-key/:key',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Look up an order, idempotency hash, and ledger trail by Idempotency-Key',
        params: IdempotencyKeyParamsSchema,
        response: {
          200: OrderDetailDtoSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      return getOrderDetailByIdempotencyKey(fastify.db, request.params.key);
    },
  );

  fastify.get(
    '/orders/:id',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Look up an order, idempotency metadata, and ledger trail by Order ID',
        params: OrderIdParamsSchema,
        response: {
          200: OrderDetailDtoSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      return getOrderDetailById(fastify.db, request.params.id);
    },
  );

  fastify.post(
    '/orders/:id/cancel',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Idempotently cancel an order and release its reserved stock once',
        params: OrderIdParamsSchema,
        response: {
          200: CancelOrderResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const result = await cancelOrder(fastify.db, request.params.id);

      request.log.info(
        {
          orderId: result.order.id,
          alreadyCancelled: result.alreadyCancelled,
        },
        result.alreadyCancelled
          ? 'Order cancellation idempotent replay'
          : 'Order cancelled and inventory released',
      );

      return result;
    },
  );
};
