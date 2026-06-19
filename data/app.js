const { exec } = require('child_process');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 自动打开浏览器
const openBrowser = () => {
    const url = 'http://localhost:3000';
    const start = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${start} ${url}`);
};

// 复制原有的 server.js 代码（完整粘贴到这里）
// 注意：需要把原有的 server.js 整个代码复制到此处

// 启动服务
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    openBrowser();
});