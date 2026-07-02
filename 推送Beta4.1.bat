@echo off
chcp 65001 >nul
echo ========================================
echo   LN Chat Beta 4.1 一键推送
echo ========================================
echo.

cd /d "I:\文件\LN"

echo [1/3] 暂存变更...
git add railway-deploy/server.js railway-deploy/public/index.html
if %errorlevel% neq 0 (
    echo  暂存失败！
    pause
    exit /b 1
)
echo  完成

echo [2/3] 提交...
git commit -m "Beta 4.1: 数据持久化/细粒度权限/Enter换行Ctrl+Enter发送/群解散退出私信/BBCode全面增强"
if %errorlevel% neq 0 (
    echo  提交失败（可能没有变更或已提交）
    pause
    exit /b 1
)
echo  完成

echo [3/3] 推送到 GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo  推送失败！请检查网络或 SSH 密钥
    pause
    exit /b 1
)

echo.
echo ========================================
echo   推送成功！Railway 将自动重新部署
echo   部署地址: https://ln-chat-production.up.railway.app
echo ========================================
pause
