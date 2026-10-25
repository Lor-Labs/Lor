# Lor workbench image for Blaxel sandboxes: the Pi coding agent (node 22),
# Claude Code's harness bridge, and the Python data toolchain. Push with
# `bl push` from this directory;
# sandboxes reference it via LOR_WORKBENCH_IMAGE.
ARG SANDBOX_VERSION=latest
FROM ghcr.io/blaxel-ai/sandbox:${SANDBOX_VERSION} AS sandbox-api

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource-setup.sh \
    && bash /tmp/nodesource-setup.sh \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -f /tmp/nodesource-setup.sh \
    && rm -rf /var/lib/apt/lists/*

# Exact-pinned: buildPiCommand's flag set is validated against this version.
RUN npm install -g @earendil-works/pi-coding-agent@0.84.1

RUN pip install --no-cache-dir pandas matplotlib openpyxl pdfplumber

# Claude Code sessions (reference/planned/code-sessions-runbook.md chunk 7):
# the packages of @ai-sdk/harness-claude-code's sandbox bridge (Claude Code
# CLI and Agent SDK), installed where the adapter's bootstrap puts them. A new
# sandbox's bootstrap then finds them ("Already up to date", about 2 s)
# instead of downloading about 500 MB. Keep the version equal to packages/lor's;
# pnpm 10 honors the bridge's allowBuilds (Claude Code's postinstall).
ARG CLAUDE_CODE_ADAPTER=1.0.162
RUN npm install -g pnpm@10.34.8 \
    && dir=/root/.ai-sdk-harness/.harness-bootstrap/claude-code \
    && mkdir -p "$dir" && cd /tmp \
    && npm pack "@ai-sdk/harness-claude-code@${CLAUDE_CODE_ADAPTER}" --silent \
    && tar -xzf ai-sdk-harness-claude-code-*.tgz \
    && cp package/dist/bridge/package.json package/dist/bridge/pnpm-lock.yaml \
    package/dist/bridge/pnpm-workspace.yaml "$dir"/ \
    && rm -rf package ai-sdk-harness-claude-code-*.tgz \
    && cd "$dir" && pnpm install --frozen-lockfile --store-dir .pnpm-store \
    && ./node_modules/.bin/claude --version

RUN mkdir -p /workspace/in /workspace/out /workspace/.pi-sessions /root/.pi/agent

ENV HOME=/root

# The sandbox-api binary is required in every Blaxel image — it serves the
# process/filesystem API the SDK talks to.
COPY --from=sandbox-api /sandbox-api /usr/local/bin/sandbox-api

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/sandbox-api"]
