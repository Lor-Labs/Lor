#!/usr/bin/env bash
# The Lor workbench on a Boat VM (Ubuntu), the same tools as ../Dockerfile:
# run as root by build-template.ts with the image folder copied to
# /tmp/lor-image, then saved as the Boat template.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SRC=/tmp/lor-image
cd /tmp

. /etc/os-release
arch="$(dpkg --print-architecture)"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  git curl ca-certificates python3 python3-pip \
  tmux zsh zsh-autosuggestions zsh-syntax-highlighting iproute2 lsof procps \
  xvfb xauth x11-xserver-utils openbox libnss3-tools ffmpeg \
  fonts-liberation fonts-noto-color-emoji unzip >/dev/null

# Node 26 (NodeSource), as in the image.
if ! node --version 2>/dev/null | grep -q '^v26\.'; then
  curl -fsSL https://deb.nodesource.com/setup_26.x -o nodesource-setup.sh
  bash nodesource-setup.sh >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  rm -f nodesource-setup.sh
fi

npm install -g --no-audit --no-fund @earendil-works/pi-coding-agent@0.84.1 pnpm@10.34.8 >/dev/null
pip3 install --quiet --break-system-packages pandas matplotlib openpyxl pdfplumber

# Claude Code and Codex bridges, bootstrapped ahead (Dockerfile, chunks 7-8).
for harness in claude-code codex; do
  dir="/root/.ai-sdk-harness/.harness-bootstrap/$harness"
  mkdir -p "$dir"
  cp -a "$SRC/$harness/." "$dir/"
  (cd "$dir" && pnpm install --frozen-lockfile --store-dir .pnpm-store >/dev/null)
done
/root/.ai-sdk-harness/.harness-bootstrap/claude-code/node_modules/.bin/claude --version
mkdir -p /root/.codex
cp "$SRC/codex-config.toml" /root/.codex/config.toml

# Terminal tab: ttyd, starship.
case "$arch" in amd64) ttyd_arch=x86_64 ;; arm64) ttyd_arch=aarch64 ;; esac
curl -fsSLO "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${ttyd_arch}"
curl -fsSL -o ttyd.sums https://github.com/tsl0922/ttyd/releases/download/1.7.7/SHA256SUMS
grep " ttyd.${ttyd_arch}\$" ttyd.sums | sha256sum -c -
install -m 755 "ttyd.${ttyd_arch}" /usr/local/bin/ttyd
rm -f "ttyd.${ttyd_arch}" ttyd.sums
curl -fsSL -o starship-install.sh https://starship.rs/install.sh
sh starship-install.sh --yes --version v1.27.0 >/dev/null
rm -f starship-install.sh
cp "$SRC/terminal/tmux.conf" /root/.tmux.conf
cp "$SRC/terminal/zshrc" /root/.zshrc

# Bun and Yarn (Corepack), as in the image.
case "$arch" in amd64) bun_target=linux-x64-baseline ;; arm64) bun_target=linux-aarch64 ;; esac
curl -fsSLO "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-${bun_target}.zip"
curl -fsSL -o bun.sums https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/SHASUMS256.txt
grep " bun-${bun_target}.zip\$" bun.sums | sha256sum -c -
unzip -q "bun-${bun_target}.zip" -d /tmp/bun
install -m 755 "/tmp/bun/bun-${bun_target}/bun" /usr/local/bin/bun
ln -sf /usr/local/bin/bun /usr/local/bin/bunx
rm -rf /tmp/bun "bun-${bun_target}.zip" bun.sums
npm install -g --no-audit --no-fund --prefix /opt/corepack corepack@0.36.0 >/dev/null
/opt/corepack/bin/corepack enable --install-directory /usr/local/bin yarn

# The session browser: Chromium is a snap on Ubuntu, so Google Chrome (Boat
# preinstalls it) stands in under the name lor-browser-start runs.
if ! command -v google-chrome >/dev/null; then
  curl -fsSL -o chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq ./chrome.deb >/dev/null
  rm -f chrome.deb
fi
ln -sf "$(command -v google-chrome)" /usr/local/bin/chromium
case "${VERSION_ID}-${arch}" in
  24.04-amd64) selkies_sha=4bc87969acf45951fbf6148b9d7e23717df58411e5a47d361b99b78842caaa8c ;;
  26.04-amd64) selkies_sha=69e0f7412c6b8eb34d1b1df916a3f870219595ad47600343077d44d6e0430490 ;;
  *) echo "No Selkies package for Ubuntu ${VERSION_ID} ${arch}"; exit 1 ;;
esac
selkies_deb="selkies-2.2.1-ubuntu${VERSION_ID}-${arch}.deb"
curl -fsSLO "https://github.com/selkies-project/selkies/releases/download/2.2.1/${selkies_deb}"
echo "${selkies_sha}  ${selkies_deb}" | sha256sum -c -
apt-get install -y -qq --no-install-recommends "./${selkies_deb}" >/dev/null
rm -f "${selkies_deb}"
npm install -g --no-audit --no-fund --prefix /opt/agent-browser agent-browser@0.41.1 >/dev/null
/opt/agent-browser/bin/agent-browser --version
npm install --prefix /opt/lor-browser --no-audit --no-fund ws@8.22.1 >/dev/null
install -m 755 "$SRC/browser/lor-browser-start" "$SRC/browser/lor-browser" /usr/local/bin/
cp "$SRC/browser/gateway.mjs" /opt/lor-browser/gateway.mjs

mkdir -p /workspace/in /workspace/out /workspace/.pi-sessions /root/.pi/agent
rm -rf "$SRC"
apt-get clean
echo "lor-workbench ready"
