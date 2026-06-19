@echo off
echo Preparing railway-deploy folder...

:: 复制并修改 index.html（把 localhost:3000 替换为动态地址）
set SRC=..\index.html
set DST=index.html

powershell -Command "(Get-Content '%SRC%' -Raw) -replace 'const API_BASE = ''http://localhost:3000/api'';  // 修改为你的后端地址\r\n    const SOCKET_URL = ''http://localhost:3000'';', 'const _origin = window.location.origin; const API_BASE = _origin + ''/api''; const SOCKET_URL = _origin;' | Set-Content '%DST%' -Encoding UTF8"

if exist index.html (
    echo [OK] index.html created successfully
) else (
    echo [FAIL] index.html not created, please copy manually
)

echo.
echo Done! Now run: deploy-to-railway.bat
pause
