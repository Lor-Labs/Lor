# Lor workbench image for Blaxel sandboxes: the Pi coding agent (node 22),
# Claude Code's harness bridge, and the Python data toolchain. Run
# claude-code-bootstrap.ts first, then `bl push` from this directory (never
# from the repo root: bl reads the .env it finds and prints it when parsing
# fails); sandboxes reference it via LOR_WORKBENCH_IMAGE.
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
# @ai-sdk/harness-claude-code's bootstrap, done ahead. claude-code/ (from
# claude-code-bootstrap.ts) holds the sandbox bridge as Lor's patch leaves it
# and the marker that makes a new sandbox skip the bootstrap; this installs
# the bridge's packages (Claude Code CLI and Agent SDK, about 500 MB) with
# the adapter's own commands. pnpm 10 honors the bridge's allowBuilds
# (Claude Code's postinstall).
ARG CLAUDE_CODE_BOOTSTRAP=/root/.ai-sdk-harness/.harness-bootstrap/claude-code
RUN npm install -g pnpm@10.34.8
COPY claude-code/package.json claude-code/pnpm-lock.yaml \
    claude-code/pnpm-workspace.yaml ${CLAUDE_CODE_BOOTSTRAP}/
RUN cd ${CLAUDE_CODE_BOOTSTRAP} \
    && pnpm install --frozen-lockfile --store-dir .pnpm-store \
    && ./node_modules/.bin/claude --version
COPY claude-code/ ${CLAUDE_CODE_BOOTSTRAP}/

RUN mkdir -p /workspace/in /workspace/out /workspace/.pi-sessions /root/.pi/agent

ENV HOME=/root

# The sandbox-api binary is required in every Blaxel image — it serves the
# process/filesystem API the SDK talks to.
COPY --from=sandbox-api /sandbox-api /usr/local/bin/sandbox-api

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/sandbox-api"]
