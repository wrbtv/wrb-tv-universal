@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==========================================
echo        WRB-TV PLAYER - BUILD WINDOWS
echo ==========================================
echo.
echo Instalando dependencias...
call npm install
if errorlevel 1 (
  echo.
  echo ERRO: npm install falhou.
  pause
  exit /b 1
)
echo.
echo Gerando instalador e versao portatil...
call npm run dist
if errorlevel 1 (
  echo.
  echo ERRO: a compilacao falhou.
  pause
  exit /b 1
)
echo.
echo ==========================================
echo CONCLUIDO
echo Arquivos em: release\
echo ==========================================
pause
