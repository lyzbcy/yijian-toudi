@echo off
setlocal
chcp 65001 >nul
node "%~dp0..\scripts\ai-preview.cjs" stop
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" if not "%YJT_PREVIEW_NO_PAUSE%"=="1" pause
exit /b %RESULT%
