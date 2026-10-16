@echo off
REM ============================================================
REM  IoT Platform - one-click launcher (backend + frontend)
REM
REM  All logic lives in scripts\start.mjs so that Windows / macOS
REM  / Linux share the same behaviour:
REM    * frees ports 3000 / 5173 by ending the occupying process
REM    * picks a Node runtime compatible with better-sqlite3 (ABI)
REM    * starts backend + frontend, prefixes their logs
REM    * Ctrl+C stops everything
REM
REM  Usage:  start.bat [--no-kill] [--watch] [--backend-only]
REM                    [--frontend-only] [--api-port 3000]
REM ============================================================
setlocal
cd /d "%~dp0"

REM Switch console to UTF-8 so the launcher's Chinese output renders correctly.
chcp 65001 >nul 2>nul
title IoT Platform Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo         Install Node 22 or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\start.mjs" %* --frontend-only
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Launcher exited with code %EXIT_CODE%.
  pause
)

endlocal & exit /b %EXIT_CODE%
