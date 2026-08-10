# Merlin workbench image for Blaxel sandboxes: the Pi coding agent (node 22)
# plus the Python data toolchain. Push with `bl push` from this directory;
# sandboxes reference it via MERLIN_WORKBENCH_IMAGE.
ARG SANDBOX_VERSION=latest
FROM ghcr.io/blaxel-ai/sandbox:${SANDBOX_VERSION} AS sandbox-api

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Exact-pinned: buildPiCommand's flag set is validated against this version.
RUN npm install -g @earendil-works/pi-coding-agent@0.84.1

RUN pip install --no-cache-dir pandas matplotlib openpyxl pdfplumber

RUN mkdir -p /workspace/in /workspace/out /workspace/.pi-sessions /root/.pi/agent

ENV HOME=/root

# The sandbox-api binary is required in every Blaxel image — it serves the
# process/filesystem API the SDK talks to.
COPY --from=sandbox-api /sandbox-api /usr/local/bin/sandbox-api

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/sandbox-api"]
