"""
运行此脚本以准备 Railway 部署所需的 index.html
用法: python prepare.py
"""
import os, sys, re

src = os.path.join(os.path.dirname(__file__), '..', 'index.html')
dst = os.path.join(os.path.dirname(__file__), 'index.html')

if not os.path.exists(src):
    print(f'ERROR: 找不到 {src}')
    sys.exit(1)

with open(src, 'r', encoding='utf-8') as f:
    content = f.read()

old = """    const API_BASE = 'http://localhost:3000/api';  // 修改为你的后端地址
    const SOCKET_URL = 'http://localhost:3000';"""

new = """    // 自动识别当前域名，兼容本地开发和云端部署
    const _origin = window.location.origin;
    const API_BASE = _origin + '/api';
    const SOCKET_URL = _origin;"""

if old not in content:
    print('WARNING: 目标字符串未找到，可能已经修改过或格式不匹配')
    print('请手动将 index.html 里的以下内容：')
    print("  const API_BASE = 'http://localhost:3000/api';")
    print("  const SOCKET_URL = 'http://localhost:3000';")
    print('替换为：')
    print("  const _origin = window.location.origin;")
    print("  const API_BASE = _origin + '/api';")
    print("  const SOCKET_URL = _origin;")
else:
    content = content.replace(old, new)
    print('OK: 已替换 API_BASE 和 SOCKET_URL')

with open(dst, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'OK: index.html 已生成 ({len(content)} 字节)')
print('下一步: 上传 railway-deploy 目录到 GitHub，然后在 Railway 部署')
