@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo ================================================
echo        WRB-TV PLAYER - INSTALADOR WINDOWS
echo ================================================
echo.
echo [1/2] Instalando dependencias...
call npm install
if errorlevel 1 (
  echo.
  echo ERRO: npm install falhou.
  pause
  exit /b 1
)

echo.
echo [2/2] Gerando instalador NSIS...
call npm run dist:installer
if errorlevel 1 (
  echo.
  echo ERRO: a compilacao do instalador falhou.
  pause
  exit /b 1
)

echo.
echo ================================================
echo CONCLUIDO

for /f "delims=" %%V in ('node -p "require("./package.json").version"') do set "VERSION=%%V"
echo.
echo O instalador esta em:
echo release\WRB-TV-Player-Setup-%VERSION%-x64.exe
echo.
echo Esse arquivo instala o WRB-TV Player no Windows,
echo cria o atalho na Area de Trabalho e no Menu Iniciar.
echo.
echo Os dados de acesso sao mantidos pelo aplicativo.
echo ================================================
pause
