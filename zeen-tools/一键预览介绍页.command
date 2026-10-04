#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_NODE="/Users/zeen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
RUNTIME_BIN="/Users/zeen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"

if ! command -v node >/dev/null 2>&1 && [[ -x "$RUNTIME_NODE/node" ]]; then
  export PATH="$RUNTIME_NODE:$RUNTIME_BIN:$PATH"
fi

cd "$PROJECT_ROOT"
mkdir -p .local-data
SITE_PREVIEW_PORT=4173 nohup node scripts/site-preview.cjs > .local-data/site.log 2>&1 &
echo $! > .local-data/site.pid

for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:4173/" >/dev/null 2>&1; then
    open "http://127.0.0.1:4173/"
    echo "介绍页已打开：http://127.0.0.1:4173/"
    exit 0
  fi
  sleep .2
done

echo "介绍页启动失败，请查看 .local-data/site.log"
exit 1
