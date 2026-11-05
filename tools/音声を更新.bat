@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where py >nul 2>nul
if %errorlevel%==0 (py tools\make_card_audio.py %*) else (python tools\make_card_audio.py %*)
echo.
pause
