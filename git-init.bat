@echo off
chcp 65001 > nul
echo ===== LN 项目 Git 部署脚本 =====
echo.

REM 添加安全目录
git config --global --add safe.directory "D:/文件/LN"

cd /d "D:/文件/LN"

REM 检查是否已是 git 仓库
if not exist ".git\" (
    echo [1/5] 初始化 Git 仓库...
    git init --initial-branch=main
    echo.
)

REM 检查 git 状态
echo [2/5] 检查文件状态...
git status
echo.

REM 添加所有文件（.gitignore 会自动排除 node_modules 等）
echo [3/5] 添加文件到暂存区...
git add .
git status
echo.

REM 提交
echo [4/5] 创建初始提交...
git commit -m "初始提交：LN 聊天系统 v1.0.0"
echo.

echo [5/5] 推送到 GitHub
echo.
echo 请先手动在 GitHub 创建名为 ln-chat 的仓库（不要勾选初始化 README）
echo 然后运行以下命令：
echo.
echo   git remote add origin https://github.com/xusd2023/ln-chat.git
echo   git push -u origin main
echo.
echo 如果提示登录，按 GitHub 指示操作即可。
echo.
pause
