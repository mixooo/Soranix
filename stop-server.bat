@echo off
rem Stops Soranix's background server (the one Soranix.vbs starts on port 8888).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:8888 .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1
echo Soranix server stopped.
timeout /t 2 >nul
