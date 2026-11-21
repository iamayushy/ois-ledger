ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/

FROM base AS build
RUN --mount=type=cache,id=ois-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@ois/api..."
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/db/tsconfig.json packages/db/
COPY packages/db/src packages/db/src
COPY packages/db/drizzle packages/db/drizzle
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
RUN pnpm --filter "@ois/api..." run typecheck \
 && pnpm --filter @ois/api run bundle

FROM base AS prod-deps
RUN --mount=type=cache,id=ois-pnpm-store,target=/pnpm/store \
    pnpm --filter @ois/api deploy --prod --legacy --config.node-linker=hoisted /out

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    DOTENV_CONFIG_QUIET=true
WORKDIR /app
COPY --from=prod-deps --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/drizzle ./drizzle
COPY --chown=node:node apps/api/package.json ./package.json
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/api/health" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
