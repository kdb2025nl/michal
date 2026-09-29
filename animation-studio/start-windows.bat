@echo off
cd /d "%~dp0"
where node >nul 2>nul || winget install -e --id OpenJS.NodeJS.LTS
where python >nul 2>nul || where py >nul 2>nul || winget install -e --id Python.Python.3.12
echo Jesli wlasnie cos zainstalowano, zamknij to okno i kliknij plik ponownie.
if not exist node_modules call npm install
if not exist .venv call npm run setup
call npm run app
pause
