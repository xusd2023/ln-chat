@echo off
title LN Chat - Tunnel

echo Starting LN Chat Server...
start /B "" "I:\文件\LN\LN.exe"

echo.
echo Creating tunnel to internet...
echo The public URL will appear below, share it with friends!
echo Press Ctrl+C to stop
echo.

C:\Users\Administrator.DESKTOP-4KKAP0B\AppData\Roaming\npm\lt.cmd --port 3000
