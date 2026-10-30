# Lor workbench image for Blaxel sandboxes: the Pi coding agent (Node 26 LTS),
# the Claude Code and Codex harness bridges, and the Python data toolchain.
# Run harness-bootstrap.ts first, then `bl push` from this directory (never
# from the repo root: bl reads the .env it finds and prints it when parsing
# fails); sandboxes reference it via LOR_WORKBENCH_IMAGE.
ARG SANDBOX_VERSION=latest
FROM ghcr.io/blaxel-ai/sandbox:${SANDBOX_VERSION} AS sandbox-api

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_26.x -o /tmp/nodesource-setup.sh \
    && bash /tmp/nodesource-setup.sh \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -f /tmp/nodesource-setup.sh \
    && rm -rf /var/lib/apt/lists/*

# Exact-pinned: buildPiCommand's flag set is validated against this version.
RUN npm install -g @earendil-works/pi-coding-agent@0.84.1

RUN pip install --no-cache-dir pandas matplotlib openpyxl pdfplumber

# Claude Code and Codex sessions (reference/planned/code-sessions-runbook.md
# chunks 7 and 8): each adapter's bootstrap, done ahead. claude-code/ and
# codex/ (from harness-bootstrap.ts) hold the sandbox bridge as Lor's patches
# leave it and the marker that makes a new sandbox skip the bootstrap; this
# installs the bridges' packages (Claude Code CLI and Agent SDK, about
# 500 MB; the Codex CLI) with the adapters' own commands. pnpm 10 honors
# the Claude Code bridge's allowBuilds (Claude Code's postinstall).
ARG CLAUDE_CODE_BOOTSTRAP=/root/.ai-sdk-harness/.harness-bootstrap/claude-code
ARG CODEX_BOOTSTRAP=/root/.ai-sdk-harness/.harness-bootstrap/codex
RUN npm install -g pnpm@10.34.8
COPY claude-code/package.json claude-code/pnpm-lock.yaml \
    claude-code/pnpm-workspace.yaml ${CLAUDE_CODE_BOOTSTRAP}/
RUN cd ${CLAUDE_CODE_BOOTSTRAP} \
    && pnpm install --frozen-lockfile --store-dir .pnpm-store \
    && ./node_modules/.bin/claude --version
COPY claude-code/ ${CLAUDE_CODE_BOOTSTRAP}/
COPY codex/package.json codex/pnpm-lock.yaml ${CODEX_BOOTSTRAP}/
RUN cd ${CODEX_BOOTSTRAP} \
    && pnpm install --frozen-lockfile --store-dir .pnpm-store
COPY codex/ ${CODEX_BOOTSTRAP}/

# Codex in Lor sessions: no update checks, analytics or feedback; no plugins
# (Codex clones OpenAI's curated plugin repo, about 93 MB a sandbox), no
# ChatGPT apps (their traffic skips Codex's network controls) and no
# memories (Lor keeps the team's).
COPY codex-config.toml /root/.codex/config.toml

# The session Terminal tab (reference/dev-environment-runbook.md §4): ttyd
# serves a PTY over a WebSocket, tmux keeps each person's shell across
# reconnects, zsh with a starship prompt, suggestions and highlighting;
# ss, lsof and ps for people and Lor (Lor's own port list reads /proc).
ARG TTYD_VERSION=1.7.7
ARG STARSHIP_VERSION=v1.27.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux zsh zsh-autosuggestions zsh-syntax-highlighting \
    iproute2 lsof procps \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) ttyd_arch=x86_64 ;; arm64) ttyd_arch=aarch64 ;; *) echo "unsupported $arch" && exit 1 ;; esac \
    && cd /tmp \
    && curl -fsSLO "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ttyd_arch}" \
    && curl -fsSL -o ttyd.sums "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/SHA256SUMS" \
    && grep " ttyd.${ttyd_arch}\$" ttyd.sums | sha256sum -c - \
    && install -m 755 "ttyd.${ttyd_arch}" /usr/local/bin/ttyd \
    && rm -f "ttyd.${ttyd_arch}" ttyd.sums \
    && curl -fsSL -o starship-install.sh https://starship.rs/install.sh \
    && sh starship-install.sh --yes --version "${STARSHIP_VERSION}" \
    && rm -f starship-install.sh

# Package managers repos ask for beyond npm and pnpm: Bun (checksum-checked;
# the x64 baseline build runs on CPUs without AVX2) and Yarn through Corepack,
# installed from npm since newer Node releases may not bundle it. pnpm stays
# the pinned global install above.
ARG BUN_VERSION=1.4.4
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) bun_target=linux-x64-baseline ;; arm64) bun_target=linux-aarch64 ;; *) echo "unsupported $arch" && exit 1 ;; esac \
    && cd /tmp \
    && curl -fsSLO "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${bun_target}.zip" \
    && curl -fsSL -o bun.sums "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/SHASUMS256.txt" \
    && grep " bun-${bun_target}.zip\$" bun.sums | sha256sum -c - \
    && python -m zipfile -e "bun-${bun_target}.zip" /tmp/bun \
    && install -m 755 "/tmp/bun/bun-${bun_target}/bun" /usr/local/bin/bun \
    && ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
    && rm -rf /tmp/bun "bun-${bun_target}.zip" bun.sums \
    && bun --version \
    && npm install -g corepack@0.36.0 \
    && corepack enable yarn
COPY terminal/tmux.conf /root/.tmux.conf
COPY terminal/zshrc /root/.zshrc

RUN mkdir -p /workspace/in /workspace/out /workspace/.pi-sessions /root/.pi/agent

ENV HOME=/root

# The sandbox-api binary is required in every Blaxel image — it serves the
# process/filesystem API the SDK talks to.
COPY --from=sandbox-api /sandbox-api /usr/local/bin/sandbox-api

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/sandbox-api"]
