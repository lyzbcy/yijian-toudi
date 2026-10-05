@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-preview.ps1" start
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" if not "%YJT_PREVIEW_NO_PAUSE%"=="1" pause
exit /b %RESULT%
