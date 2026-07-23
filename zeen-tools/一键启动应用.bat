@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 20+，请先安装。
  pause
  exit /b 1
)

if not exist node_modules (
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install
  ) else (
    call pnpm install
  )
)

where pnpm >nul 2>nul
if errorlevel 1 (
  start "一键投递开发版" cmd /k "cd /d "%PROJECT_ROOT%" && npm start"
) else (
  start "一键投递开发版" cmd /k "cd /d "%PROJECT_ROOT%" && pnpm start"
)
