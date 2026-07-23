@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = [Regex]::Escape('%PROJECT_ROOT%'); $processes = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'electron.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -match $root }; if (-not $processes) { Write-Host '未找到正在运行的一键投递开发进程。'; exit 0 }; $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('已停止 PID: ' + $_.ProcessId) }"
pause
