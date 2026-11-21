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
RUN pnpm install --frozen-lockfile --filter "@ois/api..."

FROM base AS build
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
WORKDIR /out
RUN cp /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./ \
 && mkdir -p packages/shared packages/db apps/api \
 && cp /repo/packages/shared/package.json packages/shared/ \
 && cp /repo/packages/db/package.json packages/db/ \
 && cp /repo/apps/api/package.json apps/api/ \
 && pnpm install --prod --frozen-lockfile --offline --ignore-scripts --filter @ois/api \
 && rm -rf apps/api/node_modules/@ois packages

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    DOTENV_CONFIG_QUIET=true
WORKDIR /app/apps/api
COPY --from=prod-deps --chown=node:node /out/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /out/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/drizzle ./drizzle
COPY --chown=node:node apps/api/package.json ./package.json
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- --header="x-proxy-secret: ${PROXY_SHARED_SECRET:-}" "http://127.0.0.1:${API_PORT}/api/health" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
