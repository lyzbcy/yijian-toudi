#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$PROJECT_ROOT/.local-data/site.pid"

if [[ -f "$PID_FILE" ]]; then
  SITE_PID="$(tr -dc '0-9' < "$PID_FILE")"
  if [[ -n "$SITE_PID" ]] && ps -p "$SITE_PID" -o command= 2>/dev/null | grep -F "site-preview.cjs" >/dev/null; then
    kill "$SITE_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
echo "介绍页预览服务已关闭。"
