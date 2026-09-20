@echo off
chcp 65001 >nul
title OptiDesk
cd /d "%~dp0api"
if not exist .venv (
  echo Premiere installation : preparation de l'environnement, patientez...
  python -m venv .venv || (echo Python 3.11 ou plus est requis : https://www.python.org/downloads/ & pause & exit /b 1)
  .venv\Scripts\python -m pip install -q -r requirements.txt
)
start "" /b cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8765"
echo OptiDesk demarre sur http://127.0.0.1:8765  (fermez cette fenetre pour l'arreter)
.venv\Scripts\python run_exe.py
