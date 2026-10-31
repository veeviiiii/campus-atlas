@echo off
rem Double-click to open the intake desk in your browser (python -m pipeline.desk, without a console).
rem Double-clicking again while it runs just opens it again. Close it with "Close" on the page.
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo The project's Python is missing: there is no .venv folder here.
  echo Set it up once as "Run it yourself" in README.md says, then double-click this again.
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" -m pipeline.desk %*
