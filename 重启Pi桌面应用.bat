@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在关闭旧的 Pi Desktop（仅本应用的进程）...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='electron.exe'\" | Where-Object { $_.ExecutablePath -like '%~dp0*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

echo 正在启动 Pi Desktop...
start "" "%~dp0node_modules\electron\dist\electron.exe" .
echo 完成！
