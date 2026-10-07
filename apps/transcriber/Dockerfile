# Node, not Bun: @livekit/rtc-node is a native Node module, and the agents SDK
# runs each call in a forked Node child process.
FROM node:24-slim
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ ./patches/
COPY apps/transcriber/ ./apps/transcriber/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/transcriber
CMD ["node", "--import", "tsx", "src/index.ts", "start"]
