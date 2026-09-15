# Headless server image: sync + REST API. Uses the official Playwright image so
# Chromium and all its system libraries are already present (unlike a bare node
# image). Interactive `login` needs a display — see README "Headless / remote
# setup" for how to authenticate providers on a server with no screen.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Install dependencies (cached on lockfile changes).
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile --filter @vod/server...

# Build the server to dist/.
FROM deps AS build
COPY apps/server apps/server
RUN pnpm --filter @vod/server build

# Runtime image.
FROM base AS runtime
ENV NODE_ENV=production
# Bind to all interfaces inside the container; publish the port deliberately.
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY apps/server/drizzle ./apps/server/drizzle
COPY apps/server/package.json ./apps/server/package.json
VOLUME /data
EXPOSE 3000
WORKDIR /app/apps/server
# The browser profiles + SQLite live under /data (mounted volume).
CMD ["node", "dist/main.js"]
