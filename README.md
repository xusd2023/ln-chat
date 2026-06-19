# LN 聊天系统

仿微信风格的实时聊天应用，基于 Node.js + Socket.IO 构建。

## 功能特性

- 💬 实时聊天（单聊 / 群聊）
- 📝 社区帖子（发帖 / 评论 / 点赞）
- 🖼️ 图片 & 文件上传
- 🌐 LaTeX 数学公式渲染
- �markdown 内容支持
- 📱 移动端适配

## 项目结构

```
LN/
├── index.html              ← 前端页面
├── package.json            ← 项目配置
├── data/                  ← 本地版源码
│   ├── server.js          ← 本地服务器（pkg 打包版）
│   └── package.json
├── railway-deploy/        ← Railway 云端部署版
│   ├── server.js          ← 部署服务器
│   └── public/
│       └── index.html
├── LN.exe                 ← Windows 可执行文件（双击运行）
└── 部署说明.md            ← 部署文档
```

## 本地运行

```bash
# 安装依赖
npm install

# 启动本地服务器（localhost:3000）
npm run local
```

## 打包为 Windows exe

```bash
npm run build
```

生成 `LN.exe`，双击即可运行，无需安装 Node.js。

## 云端部署（Railway）

将 `railway-deploy/` 目录部署到 [Railway](https://railway.app)：

```bash
cd railway-deploy
npm install
npm start
```

## 数据流

所有数据保存在 `data/` 目录的 JSON 文件中：
- `users.json` — 用户数据
- `messages.json` — 消息记录
- `groups.json` — 群组信息
- `posts.json` — 社区帖子

> ⚠️ 本地版数据存储在本地 JSON 文件，不适合生产环境高并发场景。

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 HTML/CSS/JS
- **打包**: pkg（生成本地 exe）
- **部署**: Railway
