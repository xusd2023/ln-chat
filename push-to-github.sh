#!/bin/bash
# LN 项目推送到 GitHub 脚本
# 请在 Git Bash 中运行此脚本（右键项目文件夹 → Git Bash Here）

echo "===== LN 项目推送到 GitHub ====="
echo ""

# 检查 git 是否可用
if ! command -v git &> /dev/null; then
    echo "错误：找不到 git 命令"
    echo "请确保在 Git Bash 中运行此脚本"
    exit 1
fi

cd "$(dirname "$0")"

# 显示当前状态
echo "[1/4] 当前仓库状态："
git status
echo ""

# 设置远程仓库
echo "[2/4] 设置远程仓库..."
git remote remove origin 2>/dev/null
git remote add origin https://github.com/xusd2023/ln-chat.git
echo "远程仓库：https://github.com/xusd2023/ln-chat.git"
echo ""

# 推送
echo "[3/4] 推送到 GitHub..."
echo "如果提示登录，请按指示操作（使用浏览器或 token 认证）"
echo ""
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 推送成功！"
    echo "仓库地址：<ADDRESS_REMOVED>
else
    echo ""
    echo "❌ 推送失败。请确认："
    echo "  1. 已在 GitHub 创建 ln-chat 仓库"
    echo "  2. GitHub 用户名正确（xusd2023）"
    echo "  3. 已通过 GitHub 认证"
    echo ""
    echo "可尝试使用 Personal Access Token："
    echo "  git push https://<YOUR_TOKEN>@github.com/xusd2023/ln-chat.git main"
fi

read -p "按回车键退出..."
