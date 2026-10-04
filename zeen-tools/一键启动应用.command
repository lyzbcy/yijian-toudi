#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_NODE="/Users/zeen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
RUNTIME_BIN="/Users/zeen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"

if ! command -v node >/dev/null 2>&1 && [[ -x "$RUNTIME_NODE/node" ]]; then
  export PATH="$RUNTIME_NODE:$RUNTIME_BIN:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "未找到 Node.js" message "请先安装 Node.js 20 或更高版本。" as critical'
  exit 1
fi

cd "$PROJECT_ROOT"
mkdir -p .local-data

if [[ ! -d node_modules ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    npm install
  fi
fi

nohup "$PROJECT_ROOT/node_modules/.bin/electron" "$PROJECT_ROOT" > .local-data/app.log 2>&1 &

echo $! > .local-data/app.pid
echo "一键投递正在启动。日志：$PROJECT_ROOT/.local-data/app.log"
