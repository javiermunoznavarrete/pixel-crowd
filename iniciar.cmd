@echo off
chcp 65001 >nul
title Pantallas de concierto
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=3000
set ABRIR_NAVEGADOR=1
node server.js
pause
