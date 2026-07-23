#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="一键投递.app"
SOURCE_APP="$SCRIPT_DIR/$APP_NAME"

if [[ ! -d "$SOURCE_APP" ]]; then
  SOURCE_APP="$(find "$SCRIPT_DIR" -maxdepth 3 -type d -name "$APP_NAME" -print -quit)"
fi

if [[ -z "$SOURCE_APP" || ! -d "$SOURCE_APP" ]]; then
  echo "没有在安装脚本旁找到「$APP_NAME」。"
  echo "请把本脚本与应用放在同一个文件夹后重试。"
  read -k 1 "?按任意键退出…"
  exit 1
fi

TARGET_APP="/Applications/$APP_NAME"
echo "准备安装：$SOURCE_APP"
echo "安装位置：$TARGET_APP"

if [[ -d "$TARGET_APP" ]]; then
  read "ANSWER?检测到旧版本，是否覆盖？[y/N] "
  if [[ "$ANSWER" != "y" && "$ANSWER" != "Y" ]]; then
    echo "已取消。"
    exit 0
  fi
  osascript -e "do shell script \"rm -rf '$TARGET_APP'\" with administrator privileges"
fi

osascript -e "do shell script \"ditto '$SOURCE_APP' '$TARGET_APP' && xattr -dr com.apple.quarantine '$TARGET_APP' && chmod -R u+rwX '$TARGET_APP'\" with administrator privileges"
open "$TARGET_APP"
echo "安装完成，正在打开一键投递。"
