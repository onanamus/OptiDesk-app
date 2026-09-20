@echo off
chcp 65001 >nul
title Construction de l'installateur OptiDesk
cd /d "%~dp0"
echo.
echo  ===== OptiDesk : construction de l'installateur Windows =====
echo   Prerequis : Python 3.11+ et Node.js 20+ (une seule fois, sur CE poste de construction)
echo.
where python >nul 2>&1 || (echo [ERREUR] Python introuvable : https://www.python.org/downloads/ & pause & exit /b 1)
where npm >nul 2>&1 || (echo [ERREUR] Node.js introuvable : https://nodejs.org/ & pause & exit /b 1)

echo [1/3] Programme serveur (API + interface) avec PyInstaller...
cd api
if not exist .build-venv python -m venv .build-venv
call .build-venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt pyinstaller || goto :erreur
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build
pyinstaller optidesk-api.spec --noconfirm || goto :erreur
call deactivate
cd ..

echo [2/3] Installation des outils Electron...
cd desktop
call npm install || goto :erreur

echo [3/3] Fabrication de l'installateur...
call npm run dist || goto :erreur
cd ..

echo.
echo  TERMINE. Installateur pret a distribuer :
echo    desktop\dist\OptiDesk-Setup-1.0.0.exe
echo.
pause
exit /b 0

:erreur
echo.
echo [ERREUR] La construction a echoue : voir les messages ci-dessus.
pause
exit /b 1
