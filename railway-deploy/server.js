const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 50 * 1024 * 1024  // 50MB socket 上限
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ========== 静态文件托管（前端页面）==========
// 优先尝试 public/ 目录，否则直接读 index.html
const publicDir = path.join(__dirname, 'public');
const rootHtml = path.join(__dirname, 'index.html');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
} else if (fs.existsSync(rootHtml)) {
    app.get('/', (req, res) => res.sendFile(rootHtml));
}

// ========== 文件上传配置 ==========
const UPLOAD_DIR = path.join(os.tmpdir(), 'ln-uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const unique = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        // 保留原始文件名（URL编码处理）
        const safeName = unique + '_' + Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, safeName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB 单文件限制
});

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '没有收到文件' });
    const fileUrl = `/api/files/${encodeURIComponent(req.file.filename)}`;
    res.json({
        success: true,
        filename: req.file.filename,
        originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        size: req.file.size,
        url: fileUrl
    });
    // 24小时后自动删除
    setTimeout(() => {
        fs.unlink(req.file.path, () => {});
    }, 24 * 60 * 60 * 1000);
});

// 文件下载接口
app.get('/api/files/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在或已过期（超过24小时）' });
    // 提取原始文件名（格式：timestamp_random_原始文件名）
    const parts = filename.split('_');
    const originalName = parts.slice(2).join('_') || filename;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.sendFile(filePath);
});

// ========== 内存数据存储 ==========
let db = {
    users: [],
    groups: [],
    messages: {},        // { chatId: [msg, ...] }
    privateChats: {},    // { chatId: chatObj }
    groupNicknames: {},  // { chatId: { username: nickname } }
    posts: [],
    comments: [],
    reports: []
};

// 读写辅助（操作内存 db）
const DB = {
    getUsers: () => db.users,
    getGroups: () => db.groups,
    getMessages: () => db.messages,
    getPrivateChats: () => db.privateChats,
    getNicknames: () => db.groupNicknames,
    getPosts: () => db.posts,
    getComments: () => db.comments,
    getReports: () => db.reports,
};

// 管理员列表
const ADMIN_USERS = ['admin'];

// ========== 预置管理员账号 ==========
(function seedAdmin() {
    const existing = db.users.find(u => u.username === 'admin');
    if (!existing) {
        db.users.push({
            username: 'admin',
            nickname: '管理员',
            password: 'Xusd12345678',
            email: 'admin@example.com',
            bio: '系统管理员',
            banned: false
        });
        console.log('[Seed] 管理员账号已创建: admin / Xusd12345678');
    }
})();

// ========== 辅助函数 ==========
function getPrivateChatId(userA, userB) {
    return `private_${userA}_${userB}`;
}

function ensurePrivateChat(userA, userB) {
    const id1 = getPrivateChatId(userA, userB);
    const id2 = getPrivateChatId(userB, userA);
    let chat = db.privateChats[id1] || db.privateChats[id2];
    if (!chat) {
        chat = {
            id: id1,
            name: `${userA} 和 ${userB} 的私聊`,
            type: 'private',
            members: [userA, userB],
            created: Date.now()
        };
        db.privateChats[id1] = chat;
        db.messages[chat.id] = [];
    }
    return chat;
}

// ========== 用户相关 ==========
app.post('/api/register', (req, res) => {
    const { username, nickname, password } = req.body;
    if (db.users.find(u => u.username === username))
        return res.status(400).json({ success: false, message: '用户名已存在' });
    db.users.push({ username, nickname, password, bio: '' });
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ success: false, message: '用户名或密码错误' });
    if (user.banned) return res.status(403).json({ success: false, message: '您的账号已被管理员封禁，无法登录' });
    res.json({ success: true, nickname: user.nickname, isAdmin: ADMIN_USERS.includes(username) });
});

app.get('/api/users', (req, res) => {
    res.json(db.users.map(u => ({ username: u.username, nickname: u.nickname, bio: u.bio || '', avatar: u.avatar || '' })));
});

app.get('/api/users/:username', (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ username: user.username, nickname: user.nickname, bio: user.bio || '', avatar: user.avatar || '' });
});

app.put('/api/users/:username', (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { nickname, bio, avatar, password, oldPassword } = req.body;
    if (nickname !== undefined) user.nickname = nickname;
    if (bio !== undefined) user.bio = bio;
    if (avatar !== undefined) user.avatar = avatar;
    if (password !== undefined) {
        if (user.password !== oldPassword) return res.status(403).json({ error: '旧密码不正确' });
        if (!password || password.length < 4) return res.status(400).json({ error: '新密码至少4个字符' });
        user.password = password;
    }
    res.json({ success: true, nickname: user.nickname, bio: user.bio, avatar: user.avatar || '' });
});

app.get('/api/users/:username/liked-posts', (req, res) => {
    const { username } = req.params;
    const likedPosts = db.posts.filter(p => p.likes && p.likes.includes(username));
    const enriched = likedPosts.map(p => {
        const author = db.users.find(u => u.username === p.author);
        return { ...p, authorNickname: author ? author.nickname : p.author,
            likeCount: p.likes ? p.likes.length : 0,
            favoriteCount: p.favorites ? p.favorites.length : 0,
            commentCount: db.comments.filter(c => c.postId === p.id).length };
    });
    res.json(enriched.reverse());
});

app.get('/api/users/:username/favorited-posts', (req, res) => {
    const { username } = req.params;
    const favoritedPosts = db.posts.filter(p => p.favorites && p.favorites.includes(username));
    const enriched = favoritedPosts.map(p => {
        const author = db.users.find(u => u.username === p.author);
        return { ...p, authorNickname: author ? author.nickname : p.author,
            likeCount: p.likes ? p.likes.length : 0,
            favoriteCount: p.favorites ? p.favorites.length : 0,
            commentCount: db.comments.filter(c => c.postId === p.id).length };
    });
    res.json(enriched.reverse());
});

// ========== 群组和私聊 ==========
app.get('/api/chats/:username', (req, res) => {
    const { username } = req.params;
    const groups = db.groups.filter(g => g.members.includes(username));
    // 仅返回双方用户都存在的私聊（防止显示已删除用户的私聊）
    const userPrivateChats = Object.values(db.privateChats).filter(c => {
        if (!c.members.includes(username)) return false;
        const otherUser = c.members.find(m => m !== username);
        return otherUser && db.users.find(u => u.username === otherUser);
    });
    res.json([...groups, ...userPrivateChats]);
});

app.get('/api/messages/:chatId', (req, res) => {
    res.json(db.messages[req.params.chatId] || []);
});

app.post('/api/messages/:chatId', (req, res) => {
    const { chatId } = req.params;
    const { text, attachments, alignment, sender } = req.body;
    // 检查私聊接收者是否仍然存在
    const privateChat = db.privateChats[chatId];
    if (privateChat) {
        for (const member of privateChat.members) {
            if (member !== sender && !db.users.find(u => u.username === member)) {
                return res.status(410).json({ error: `用户 ${member} 不存在或已被删除，无法发送消息` });
            }
        }
    }
    if (!db.messages[chatId]) db.messages[chatId] = [];
    const newMsg = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        text, attachments, alignment,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sender
    };
    db.messages[chatId].push(newMsg);
    const allChats = [...db.groups, ...Object.values(db.privateChats)];
    const chat = allChats.find(c => c.id === chatId);
    if (chat) {
        chat.members.forEach(member => {
            io.to(`user_${member}`).emit('new_message', { chatId, message: newMsg });
        });
    }
    res.json(newMsg);
});

app.post('/api/groups', (req, res) => {
    const { name, creator } = req.body;
    const newId = 'group_' + Date.now();
    const newGroup = { id: newId, name, type: 'group', creator, members: [creator], created: Date.now() };
    db.groups.push(newGroup);
    db.messages[newId] = [];
    res.json(newGroup);
});

app.put('/api/groups/:id', (req, res) => {
    const group = db.groups.find(g => g.id === req.params.id);
    if (!group || group.creator !== req.body.operator) return res.status(403).json({ success: false });
    group.name = req.body.name;
    group.members.forEach(m => io.to(`user_${m}`).emit('group_updated', { groupId: group.id, newName: group.name }));
    res.json({ success: true });
});

app.post('/api/groups/:id/members', (req, res) => {
    const group = db.groups.find(g => g.id === req.params.id);
    if (!group) return res.status(404).json({ success: false, message: '群组不存在' });
    const { username, operator } = req.body;
    if (group.creator !== operator) return res.status(403).json({ success: false, message: '仅群主可添加成员' });
    if (group.members.includes(username)) return res.status(400).json({ success: false, message: '用户已在群中' });
    if (!db.users.find(u => u.username === username)) return res.status(404).json({ success: false, message: '用户不存在' });
    group.members.push(username);
    group.members.forEach(m => io.to(`user_${m}`).emit('group_member_added', { groupId: group.id, newMember: username }));
    res.json({ success: true, members: group.members });
});

app.get('/api/chats/:chatId/members', (req, res) => {
    const allChats = [...db.groups, ...Object.values(db.privateChats)];
    const chat = allChats.find(c => c.id === req.params.chatId);
    if (!chat) return res.status(404).json([]);
    const members = chat.members.map(username => {
        const user = db.users.find(u => u.username === username);
        const globalNickname = user ? user.nickname : username;
        const groupNickname = (db.groupNicknames[req.params.chatId] || {})[username] || '';
        return { username, globalNickname, groupNickname, displayName: groupNickname || globalNickname };
    });
    res.json(members);
});

app.post('/api/chats/:chatId/nickname', (req, res) => {
    const { chatId } = req.params;
    const { username, nickname } = req.body;
    if (!db.groupNicknames[chatId]) db.groupNicknames[chatId] = {};
    db.groupNicknames[chatId][username] = nickname;
    res.json({ success: true });
});

app.post('/api/private', (req, res) => {
    const { userA, userB } = req.body;
    // 检查双方用户是否存在（防止给已删除用户发私聊）
    if (!db.users.find(u => u.username === userA)) return res.status(404).json({ error: `用户 ${userA} 不存在或已被删除` });
    if (!db.users.find(u => u.username === userB)) return res.status(404).json({ error: `用户 ${userB} 不存在或已被删除` });
    const chat = ensurePrivateChat(userA, userB);
    res.json(chat);
});

// ========== 帖子相关 ==========
app.get('/api/posts', (req, res) => {
    const postsWithUser = db.posts.map(post => {
        const user = db.users.find(u => u.username === post.author);
        return { ...post, authorNickname: user ? user.nickname : post.author,
            likeCount: post.likes ? post.likes.length : 0,
            favoriteCount: post.favorites ? post.favorites.length : 0,
            commentCount: db.comments.filter(c => c.postId === post.id).length };
    });
    res.json(postsWithUser.reverse());
});

app.get('/api/posts/:id', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    const user = db.users.find(u => u.username === post.author);
    const comments = db.comments.filter(c => c.postId === req.params.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => {
            const cu = db.users.find(u => u.username === c.author);
            return { ...c, authorNickname: cu ? cu.nickname : c.author };
        });
    res.json({ ...post, authorNickname: user ? user.nickname : post.author,
        likeCount: post.likes ? post.likes.length : 0,
        favoriteCount: post.favorites ? post.favorites.length : 0,
        comments });
});

app.post('/api/posts', (req, res) => {
    const { title, content, author } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const user = db.users.find(u => u.username === author);
    if (!user) return res.status(401).json({ error: '用户未登录' });
    if (user.banned) return res.status(403).json({ error: '您的账号已被封禁，无法发帖' });
    const newPost = { id: Date.now().toString(), title, content, author,
        createdAt: Date.now(), views: 0, likes: [], favorites: [] };
    db.posts.push(newPost);
    res.json(newPost);
});

app.post('/api/posts/:id/view', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    post.views = (post.views || 0) + 1;
    res.json({ success: true, views: post.views });
});

app.post('/api/posts/:id/like', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!post.likes) post.likes = [];
    const index = post.likes.indexOf(req.body.username);
    if (index === -1) post.likes.push(req.body.username);
    else post.likes.splice(index, 1);
    res.json({ success: true, liked: index === -1, likeCount: post.likes.length });
});

app.post('/api/posts/:id/favorite', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!post.favorites) post.favorites = [];
    const index = post.favorites.indexOf(req.body.username);
    if (index === -1) post.favorites.push(req.body.username);
    else post.favorites.splice(index, 1);
    res.json({ success: true, favorited: index === -1, favoriteCount: post.favorites.length });
});

app.post('/api/posts/:id/comments', (req, res) => {
    const { content, author } = req.body;
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });
    const user = db.users.find(u => u.username === author);
    if (!user) return res.status(401).json({ error: '用户未登录' });
    if (user.banned) return res.status(403).json({ error: '您的账号已被封禁，无法评论' });
    const newComment = { id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        postId: req.params.id, content, author, createdAt: Date.now() };
    db.comments.push(newComment);
    res.json(newComment);
});

app.delete('/api/posts/:id', (req, res) => {
    const postIndex = db.posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: '帖子不存在' });
    const post = db.posts[postIndex];
    if (post.author !== req.body.username && !ADMIN_USERS.includes(req.body.username))
        return res.status(403).json({ error: '无权删除' });
    db.posts.splice(postIndex, 1);
    db.comments = db.comments.filter(c => c.postId !== req.params.id);
    res.json({ success: true });
});

app.post('/api/posts/:id/report', (req, res) => {
    db.reports.push({ postId: req.params.id, reason: req.body.reason, reporter: req.body.reporter, createdAt: Date.now() });
    res.json({ success: true });
});

// ========== 管理员 API ==========
// 封禁/解封用户
app.put('/api/admin/ban/:username', (req, res) => {
    const operator = req.body.operator;
    if (!ADMIN_USERS.includes(operator)) return res.status(403).json({ error: '无权操作' });
    const target = db.users.find(u => u.username === req.params.username);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (ADMIN_USERS.includes(target.username)) return res.status(400).json({ error: '不能封禁管理员' });
    target.banned = !target.banned;
    res.json({ success: true, banned: target.banned, message: target.banned ? '已封禁' : '已解封' });
});

// 删除用户
app.delete('/api/admin/users/:username', (req, res) => {
    const operator = req.body.operator;
    if (!ADMIN_USERS.includes(operator)) return res.status(403).json({ error: '无权操作' });
    if (ADMIN_USERS.includes(req.params.username)) return res.status(400).json({ error: '不能删除管理员' });
    const idx = db.users.findIndex(u => u.username === req.params.username);
    if (idx === -1) return res.status(404).json({ error: '用户不存在' });
    const deletedUser = req.params.username;
    db.users.splice(idx, 1);
    // 同时删除该用户的所有帖子和评论
    db.posts = db.posts.filter(p => p.author !== deletedUser);
    db.comments = db.comments.filter(c => c.author !== deletedUser);
    // 从所有群组中移除
    db.groups.forEach(g => {
        g.members = g.members.filter(m => m !== deletedUser);
    });
    // 清理所有涉及该用户的私聊记录（被删用户禁止再接收消息）
    const privateChatIdsToDelete = [];
    for (const chatId of Object.keys(db.privateChats)) {
        const chat = db.privateChats[chatId];
        if (chat.members.includes(deletedUser)) {
            privateChatIdsToDelete.push(chatId);
            // 通知另一个用户：对方已注销
            const otherUser = chat.members.find(m => m !== deletedUser);
            if (otherUser) {
                io.to(`user_${otherUser}`).emit('user_deleted', {
                    username: deletedUser,
                    chatId: chat.id
                });
            }
        }
    }
    privateChatIdsToDelete.forEach(id => {
        delete db.privateChats[id];
        delete db.messages[id];
    });
    res.json({ success: true, message: `用户 ${deletedUser} 已删除` });
});

// 获取全部用户列表（含封禁状态，仅管理员）
app.get('/api/admin/users', (req, res) => {
    const operator = req.query.operator;
    if (!ADMIN_USERS.includes(operator)) return res.status(403).json({ error: '无权操作' });
    res.json(db.users.map(u => ({
        username: u.username,
        nickname: u.nickname,
        banned: !!u.banned,
        isAdmin: ADMIN_USERS.includes(u.username)
    })));
});

// 管理员删除任意帖子
app.delete('/api/admin/posts/:id', (req, res) => {
    const operator = req.body.operator;
    if (!ADMIN_USERS.includes(operator)) return res.status(403).json({ error: '无权操作' });
    const postIndex = db.posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: '帖子不存在' });
    db.posts.splice(postIndex, 1);
    db.comments = db.comments.filter(c => c.postId !== req.params.id);
    res.json({ success: true });
});

// ========== WebSocket 实时 ==========
io.on('connection', (socket) => {
    let currentUser = null;
    socket.on('user_login', (username) => {
        currentUser = username;
        socket.join(`user_${username}`);
        socket.broadcast.emit('user_online', username);
    });
    socket.on('disconnect', () => {
        if (currentUser) socket.broadcast.emit('user_offline', currentUser);
    });
});

// ========== SPA 兜底路由 ==========
app.get('*', (req, res) => {
    const htmlFile = fs.existsSync(publicDir)
        ? path.join(publicDir, 'index.html')
        : rootHtml;
    res.sendFile(htmlFile);
});

// ========== 启动服务器 ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`LN Chat running on port ${PORT}`);
});
