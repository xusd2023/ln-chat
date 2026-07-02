@echo off
chcp 65001 >nul
cd /d "I:\文件\LN\railway-deploy"

echo ====================================
echo   LN Chat Beta 5.0 推送到 GitHub
echo ====================================
echo.

echo [1/3] 暂存文件...
git add public/index.html server.js

echo [2/3] 提交...
git commit -m "Beta 5.0"

echo [3/3] 推送到 GitHub...
git push origin main

echo.
echo ====================================
echo   推送完成！Railway 将自动重新部署。
echo ====================================
pause
