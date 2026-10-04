#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$PROJECT_ROOT/.local-data/app.pid"

if [[ -f "$PID_FILE" ]]; then
  APP_PID="$(tr -dc '0-9' < "$PID_FILE")"
  if [[ -n "$APP_PID" ]] && ps -p "$APP_PID" -o command= 2>/dev/null | grep -F "$PROJECT_ROOT" >/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

pkill -f "$PROJECT_ROOT/node_modules/electron" 2>/dev/null || true
echo "一键投递开发进程已关闭。"
