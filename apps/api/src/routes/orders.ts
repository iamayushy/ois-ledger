import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
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
      const result = await createOrder(
        fastify.db,
        request.headers['idempotency-key'],
        request.body,
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
