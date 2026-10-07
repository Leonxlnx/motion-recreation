@echo off
cd /d "%~dp0"
echo Open http://127.0.0.1:4173 in your browser.
echo Press Ctrl+C to stop the local server.
node server.mjs
pause
