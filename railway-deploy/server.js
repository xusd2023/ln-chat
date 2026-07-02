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
  maxHttpBufferSize: 50 * 1024 * 1024
});

app.use(cors());
app.use(express.json({ limit: '8mb' }));

// ========== 静态文件托管 ==========
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
        const safeName = unique + '_' + Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, safeName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '没有收到文件' });
    const fileUrl = `/api/files/${encodeURIComponent(req.file.filename)}`;
    res.json({ success: true, filename: req.file.filename,
        originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        size: req.file.size, url: fileUrl });
    setTimeout(() => fs.unlink(req.file.path, () => {}), 24 * 60 * 60 * 1000);
});

app.get('/api/files/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在或已过期' });
    const parts = filename.split('_');
    const originalName = parts.slice(2).join('_') || filename;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.sendFile(filePath);
});

// ========== 数据持久化 ==========
// Railway 提供 /data 持久化目录，本地回退到 __dirname
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
    users: [],
    groups: [],
    messages: {},
    privateChats: {},
    groupNicknames: {},
    posts: [],
    comments: [],
    reports: [],
    notifications: [],   // 通知系统
    friendRequests: [],  // 好友申请
    friends: {}          // username -> [username, ...]
};

// 从磁盘加载数据
function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            // 合并默认字段（向下兼容）
            const merged = Object.assign({}, DEFAULT_DB, parsed);
            // 确保新字段存在
            if (!merged.notifications) merged.notifications = [];
            if (!merged.friendRequests) merged.friendRequests = [];
            if (!merged.friends) merged.friends = {};
            return merged;
        }
    } catch (e) {
        console.error('[DB] 读取数据文件失败，使用空数据:', e.message);
    }
    return { ...DEFAULT_DB };
}

// 写入磁盘（防抖，500ms 合并写）
let saveTimer = null;
function saveDB() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
        } catch (e) {
            console.error('[DB] 写入数据文件失败:', e.message);
        }
    }, 500);
}

let db = loadDB();
console.log(`[DB] 数据已加载 - 用户:${db.users.length} 帖子:${db.posts.length} 消息会话:${Object.keys(db.messages).length}`);

// 管理员列表
const ADMIN_USERS = ['admin'];

// ========== 预置管理员账号 ==========
(function seedAdmin() {
    const existing = db.users.find(u => u.username === 'admin');
    if (!existing) {
        db.users.push({
            username: 'admin', nickname: '管理员',
            password: 'Xusd12345678', email: 'admin@example.com',
            bio: '系统管理员',
            role: 'admin',   // user | admin | banned
            canPost: true, canMessage: true, canComment: true, canCreateGroup: true,
            fileSizeLimit: 5 * 1024 * 1024,  // 5MB
            banned: false
        });
        saveDB();
        console.log('[Seed] 管理员账号已创建: admin / Xusd12345678');
    } else {
        // 老数据迁移：给没有权限字段的用户补充默认值
        db.users.forEach(u => {
            if (u.role === undefined) u.role = ADMIN_USERS.includes(u.username) ? 'admin' : (u.banned ? 'banned' : 'user');
            if (u.canPost === undefined) u.canPost = !u.banned;
            if (u.canMessage === undefined) u.canMessage = !u.banned;
            if (u.canComment === undefined) u.canComment = !u.banned;
            if (u.canCreateGroup === undefined) u.canCreateGroup = !u.banned;
            if (u.fileSizeLimit === undefined) u.fileSizeLimit = 5 * 1024 * 1024;
        });
        saveDB();
    }
})();

// ========== 辅助函数 ==========
function getPrivateChatId(userA, userB) { return `private_${userA}_${userB}`; }

function ensurePrivateChat(userA, userB) {
    const id1 = getPrivateChatId(userA, userB);
    const id2 = getPrivateChatId(userB, userA);
    let chat = db.privateChats[id1] || db.privateChats[id2];
    if (!chat) {
        chat = { id: id1, name: `${userA} 和 ${userB} 的私聊`, type: 'private', members: [userA, userB], created: Date.now() };
        db.privateChats[id1] = chat;
        db.messages[chat.id] = [];
        saveDB();
    }
    return chat;
}

// 创建通知辅助函数
function createNotification(toUser, type, data) {
    if (!db.notifications) db.notifications = [];
    const notif = { id: Date.now() + '_' + Math.random().toString(36).substr(2,5),
        to: toUser, type, data, read: false, createdAt: Date.now() };
    db.notifications.push(notif);
    // 只保留每个用户最近 200 条
    const userNotifs = db.notifications.filter(n => n.to === toUser);
    if (userNotifs.length > 200) {
        const oldest = userNotifs.slice(0, userNotifs.length - 200).map(n => n.id);
        db.notifications = db.notifications.filter(n => !oldest.includes(n.id));
    }
    io.to(`user_${toUser}`).emit('notification', notif);
}

function isAdmin(username) { return ADMIN_USERS.includes(username); }

// 权限检查辅助
function checkPerm(user, perm) {
    if (!user) return false;
    if (isAdmin(user.username)) return true;
    if (user.role === 'banned') return false;
    return user[perm] !== false;
}

// ========== 用户相关 ==========
app.post('/api/register', (req, res) => {
    const { username, nickname, password } = req.body;
    if (db.users.find(u => u.username === username))
        return res.status(400).json({ success: false, message: '用户名已存在' });
    db.users.push({
        username, nickname, password, bio: '', profileBgColor: '#1677ff',
        role: 'user', canPost: true, canMessage: true, canComment: true, canCreateGroup: true,
        fileSizeLimit: 5 * 1024 * 1024, banned: false
    });
    saveDB();
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ success: false, message: '用户名或密码错误' });
    if (user.role === 'banned' || user.banned) return res.status(403).json({ success: false, message: '您的账号已被封禁，无法登录' });
    res.json({ success: true, nickname: user.nickname, isAdmin: isAdmin(username) });
});

app.get('/api/users', (req, res) => {
    res.json(db.users.map(u => ({ username: u.username, nickname: u.nickname, bio: u.bio || '', avatar: u.avatar || '', profileBgColor: u.profileBgColor || '#1677ff' })));
});

app.get('/api/users/:username', (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ username: user.username, nickname: user.nickname, bio: user.bio || '', avatar: user.avatar || '', profileBgColor: user.profileBgColor || '#1677ff' });
});

app.put('/api/users/:username', (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { nickname, bio, avatar, password, oldPassword, profileBgColor } = req.body;
    if (nickname !== undefined) user.nickname = nickname;
    if (bio !== undefined) user.bio = bio;
    if (avatar !== undefined) user.avatar = avatar;
    if (profileBgColor !== undefined) user.profileBgColor = profileBgColor;
    if (password !== undefined) {
        if (user.password !== oldPassword) return res.status(403).json({ error: '旧密码不正确' });
        if (!password || password.length < 4) return res.status(400).json({ error: '新密码至少4个字符' });
        user.password = password;
    }
    saveDB();
    res.json({ success: true, nickname: user.nickname, bio: user.bio, avatar: user.avatar || '', profileBgColor: user.profileBgColor || '#1677ff' });
});

app.get('/api/users/:username/liked-posts', (req, res) => {
    const likedPosts = db.posts.filter(p => p.likes && p.likes.includes(req.params.username));
    res.json(likedPosts.reverse().map(p => {
        const author = db.users.find(u => u.username === p.author);
        return { ...p, authorNickname: author ? author.nickname : p.author,
            likeCount: p.likes ? p.likes.length : 0,
            favoriteCount: p.favorites ? p.favorites.length : 0,
            commentCount: db.comments.filter(c => c.postId === p.id).length };
    }));
});

app.get('/api/users/:username/favorited-posts', (req, res) => {
    const favoritedPosts = db.posts.filter(p => p.favorites && p.favorites.includes(req.params.username));
    res.json(favoritedPosts.reverse().map(p => {
        const author = db.users.find(u => u.username === p.author);
        return { ...p, authorNickname: author ? author.nickname : p.author,
            likeCount: p.likes ? p.likes.length : 0,
            favoriteCount: p.favorites ? p.favorites.length : 0,
            commentCount: db.comments.filter(c => c.postId === p.id).length };
    }));
});

// ========== 群组和私聊 ==========
app.get('/api/chats/:username', (req, res) => {
    const { username } = req.params;
    const groups = db.groups.filter(g => g.members.includes(username));
    const userPrivateChats = Object.values(db.privateChats).filter(c => {
        if (!c.members.includes(username)) return false;
        const other = c.members.find(m => m !== username);
        return other && db.users.find(u => u.username === other);
    });
    res.json([...groups, ...userPrivateChats]);
});

app.get('/api/messages/:chatId', (req, res) => {
    const { viewer } = req.query;
    const msgs = db.messages[req.params.chatId] || [];
    // 过滤掉该用户删除的消息
    const filtered = viewer ? msgs.filter(m => !m.deletedFor || !m.deletedFor.includes(viewer)) : msgs;
    res.json(filtered);
});

app.post('/api/messages/:chatId', (req, res) => {
    const { chatId } = req.params;
    const { text, attachments, alignment, sender, quoteMsg } = req.body;
    const senderUser = db.users.find(u => u.username === sender);
    if (!senderUser) return res.status(401).json({ error: '用户不存在' });
    if (!checkPerm(senderUser, 'canMessage')) return res.status(403).json({ error: '您没有发送私信的权限' });
    const privateChat = db.privateChats[chatId];
    if (privateChat) {
        for (const member of privateChat.members) {
            if (member !== sender && !db.users.find(u => u.username === member))
                return res.status(410).json({ error: `用户 ${member} 不存在或已被删除` });
        }
    }
    if (!db.messages[chatId]) db.messages[chatId] = [];
    const newMsg = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        text, attachments, alignment, timestamp: new Date().toISOString(), sender,
        quoteMsg: quoteMsg || null,  // 引用消息
        deletedFor: []               // 仅自己删除的用户列表
    };
    db.messages[chatId].push(newMsg);
    saveDB();
    const allChats = [...db.groups, ...Object.values(db.privateChats)];
    const chat = allChats.find(c => c.id === chatId);
    if (chat) {
        chat.members.forEach(m => io.to(`user_${m}`).emit('new_message', { chatId, message: newMsg }));
        // 检测 @mentions
        if (text) {
            const mentionRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
            let match;
            const mentioned = new Set();
            while ((match = mentionRegex.exec(text)) !== null) {
                const mentionedUser = db.users.find(u => u.username === match[1] || u.nickname === match[1]);
                if (mentionedUser && mentionedUser.username !== sender && chat.members.includes(mentionedUser.username) && !mentioned.has(mentionedUser.username)) {
                    mentioned.add(mentionedUser.username);
                    createNotification(mentionedUser.username, 'chat_mentioned', {
                        chatId, chatName: chat.name || '私聊',
                        byUser: sender, byNickname: senderUser.nickname,
                        content: text.substring(0, 50)
                    });
                }
            }
        }
    }
    res.json(newMsg);
});

app.post('/api/groups', (req, res) => {
    const { name, creator } = req.body;
    const creatorUser = db.users.find(u => u.username === creator);
    if (!checkPerm(creatorUser, 'canCreateGroup')) return res.status(403).json({ error: '您没有创建群聊的权限' });
    const newId = 'group_' + Date.now();
    const newGroup = { id: newId, name, type: 'group', creator, members: [creator], created: Date.now() };
    db.groups.push(newGroup);
    db.messages[newId] = [];
    saveDB();
    res.json(newGroup);
});

app.put('/api/groups/:id', (req, res) => {
    const group = db.groups.find(g => g.id === req.params.id);
    if (!group || group.creator !== req.body.operator) return res.status(403).json({ success: false });
    group.name = req.body.name;
    saveDB();
    group.members.forEach(m => io.to(`user_${m}`).emit('group_updated', { groupId: group.id, newName: group.name }));
    res.json({ success: true });
});

// 删除群聊（仅群主）
app.delete('/api/groups/:id', (req, res) => {
    const { operator } = req.body;
    const idx = db.groups.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '群聊不存在' });
    const group = db.groups[idx];
    if (group.creator !== operator && !isAdmin(operator)) return res.status(403).json({ error: '仅群主可解散群聊' });
    const groupId = group.id;
    // 通知成员
    group.members.forEach(m => io.to(`user_${m}`).emit('group_deleted', { groupId, name: group.name }));
    db.groups.splice(idx, 1);
    delete db.messages[groupId];
    saveDB();
    res.json({ success: true });
});

// 退出群聊
app.delete('/api/groups/:id/members/:username', (req, res) => {
    const group = db.groups.find(g => g.id === req.params.id);
    if (!group) return res.status(404).json({ error: '群聊不存在' });
    const { username } = req.params;
    if (group.creator === username) return res.status(400).json({ error: '群主不能退出，请解散群聊' });
    group.members = group.members.filter(m => m !== username);
    saveDB();
    group.members.forEach(m => io.to(`user_${m}`).emit('group_member_left', { groupId: group.id, username }));
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
    saveDB();
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
        return { username, globalNickname, groupNickname, displayName: groupNickname || globalNickname, avatar: user?.avatar || '', isCreator: chat.creator === username };
    });
    res.json(members);
});

app.post('/api/chats/:chatId/nickname', (req, res) => {
    if (!db.groupNicknames[req.params.chatId]) db.groupNicknames[req.params.chatId] = {};
    db.groupNicknames[req.params.chatId][req.body.username] = req.body.nickname;
    saveDB();
    res.json({ success: true });
});

app.post('/api/private', (req, res) => {
    const { userA, userB } = req.body;
    if (!db.users.find(u => u.username === userA)) return res.status(404).json({ error: `用户 ${userA} 不存在` });
    if (!db.users.find(u => u.username === userB)) return res.status(404).json({ error: `用户 ${userB} 不存在` });
    const chat = ensurePrivateChat(userA, userB);
    res.json(chat);
});

// ========== 帖子相关 ==========
app.get('/api/posts', (req, res) => {
    res.json(db.posts.slice().reverse().map(post => {
        const user = db.users.find(u => u.username === post.author);
        return { ...post, authorNickname: user ? user.nickname : post.author,
            likeCount: post.likes ? post.likes.length : 0,
            favoriteCount: post.favorites ? post.favorites.length : 0,
            commentCount: db.comments.filter(c => c.postId === post.id).length };
    }));
});

app.get('/api/posts/:id', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    const user = db.users.find(u => u.username === post.author);
    const comments = db.comments.filter(c => c.postId === req.params.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => { const cu = db.users.find(u => u.username === c.author); return { ...c, authorNickname: cu ? cu.nickname : c.author }; });
    res.json({ ...post, authorNickname: user ? user.nickname : post.author,
        likeCount: post.likes ? post.likes.length : 0,
        favoriteCount: post.favorites ? post.favorites.length : 0, comments });
});

app.post('/api/posts', (req, res) => {
    const { title, content, author, attachments } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const user = db.users.find(u => u.username === author);
    if (!user) return res.status(401).json({ error: '用户未登录' });
    if (!checkPerm(user, 'canPost')) return res.status(403).json({ error: '您没有发帖的权限' });
    const newPost = { id: Date.now().toString(), title, content, author,
        createdAt: Date.now(), views: 0, likes: [], favorites: [], attachments: attachments || [] };
    db.posts.push(newPost);
    saveDB();
    res.json(newPost);
});

app.post('/api/posts/:id/view', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    post.views = (post.views || 0) + 1;
    saveDB();
    res.json({ success: true, views: post.views });
});

app.post('/api/posts/:id/like', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!post.likes) post.likes = [];
    const index = post.likes.indexOf(req.body.username);
    if (index === -1) {
        post.likes.push(req.body.username);
        // 通知帖子作者（不通知自己点赞）
        if (post.author !== req.body.username) {
            const liker = db.users.find(u => u.username === req.body.username);
            createNotification(post.author, 'post_liked', {
                postId: post.id, postTitle: post.title,
                byUser: req.body.username, byNickname: liker ? liker.nickname : req.body.username
            });
            saveDB();
        }
    } else post.likes.splice(index, 1);
    saveDB();
    res.json({ success: true, liked: index === -1, likeCount: post.likes.length });
});

app.post('/api/posts/:id/favorite', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!post.favorites) post.favorites = [];
    const index = post.favorites.indexOf(req.body.username);
    if (index === -1) {
        post.favorites.push(req.body.username);
        if (post.author !== req.body.username) {
            const favor = db.users.find(u => u.username === req.body.username);
            createNotification(post.author, 'post_favorited', {
                postId: post.id, postTitle: post.title,
                byUser: req.body.username, byNickname: favor ? favor.nickname : req.body.username
            });
        }
    } else post.favorites.splice(index, 1);
    saveDB();
    res.json({ success: true, favorited: index === -1, favoriteCount: post.favorites.length });
});

app.post('/api/posts/:id/comments', (req, res) => {
    const { content, author, replyTo, attachments } = req.body;
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });
    const user = db.users.find(u => u.username === author);
    if (!user) return res.status(401).json({ error: '用户未登录' });
    if (!checkPerm(user, 'canComment')) return res.status(403).json({ error: '您没有评论的权限' });
    const newComment = { id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        postId: req.params.id, content, author, createdAt: Date.now(),
        replyTo: replyTo || null, attachments: attachments || [], likes: [] };
    db.comments.push(newComment);
    // 通知帖子作者
    const post = db.posts.find(p => p.id === req.params.id);
    if (post && post.author !== author) {
        createNotification(post.author, 'post_commented', {
            postId: post.id, postTitle: post.title,
            byUser: author, byNickname: user.nickname, commentContent: content.substring(0, 50)
        });
    }
    // 通知被回复的评论作者
    if (replyTo) {
        const parentComment = db.comments.find(c => c.id === replyTo);
        if (parentComment && parentComment.author !== author) {
            createNotification(parentComment.author, 'comment_replied', {
                postId: req.params.id, postTitle: post ? post.title : '',
                byUser: author, byNickname: user.nickname, commentContent: content.substring(0, 50)
            });
        }
    }
    // 检测 @mentions
    const mentionRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
    let match;
    const mentioned = new Set();
    while ((match = mentionRegex.exec(content)) !== null) {
        const mentionedUser = db.users.find(u => u.username === match[1] || u.nickname === match[1]);
        if (mentionedUser && mentionedUser.username !== author && !mentioned.has(mentionedUser.username)) {
            mentioned.add(mentionedUser.username);
            createNotification(mentionedUser.username, 'mentioned', {
                postId: req.params.id, postTitle: post ? post.title : '',
                byUser: author, byNickname: user.nickname, content: content.substring(0, 50)
            });
        }
    }
    saveDB();
    res.json(newComment);
});

app.delete('/api/posts/:id', (req, res) => {
    const postIndex = db.posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: '帖子不存在' });
    const post = db.posts[postIndex];
    if (post.author !== req.body.username && !isAdmin(req.body.username))
        return res.status(403).json({ error: '无权删除' });
    db.posts.splice(postIndex, 1);
    db.comments = db.comments.filter(c => c.postId !== req.params.id);
    saveDB();
    res.json({ success: true });
});

app.post('/api/posts/:id/report', (req, res) => {
    db.reports.push({ postId: req.params.id, reason: req.body.reason, reporter: req.body.reporter, createdAt: Date.now() });
    saveDB();
    res.json({ success: true });
});

app.post('/api/comments/:id/like', (req, res) => {
    const comment = db.comments.find(c => c.id === req.params.id);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (!comment.likes) comment.likes = [];
    const index = comment.likes.indexOf(req.body.username);
    if (index === -1) comment.likes.push(req.body.username);
    else comment.likes.splice(index, 1);
    saveDB();
    res.json({ success: true, liked: index === -1, likeCount: comment.likes.length });
});

// 消息撤回（本人2分钟内/管理员不限时）
app.delete('/api/messages/:chatId/:msgId', (req, res) => {
    const { chatId, msgId } = req.params;
    const { operator } = req.body;
    const msgs = db.messages[chatId];
    if (!msgs) return res.status(404).json({ error: '会话不存在' });
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx === -1) return res.status(404).json({ error: '消息不存在' });
    const msg = msgs[idx];
    if (msg.sender !== operator && !isAdmin(operator)) return res.status(403).json({ error: '只能撤回自己的消息' });
    const ageMs = Date.now() - new Date(msg.timestamp).getTime();
    if (ageMs > 2 * 60 * 1000 && !isAdmin(operator)) return res.status(400).json({ error: '超过2分钟无法撤回' });
    msg.recalled = true;
    msg.text = '[消息已撤回]';
    msg.attachments = [];
    saveDB();
    const allChatsArr = [...db.groups, ...Object.values(db.privateChats)];
    const chat = allChatsArr.find(c => c.id === chatId);
    if (chat) chat.members.forEach(m => io.to(`user_${m}`).emit('message_recalled', { chatId, msgId }));
    res.json({ success: true });
});

// 仅自己删除消息（不通知他人）
app.post('/api/messages/:chatId/:msgId/hide', (req, res) => {
    const { chatId, msgId } = req.params;
    const { username } = req.body;
    const msgs = db.messages[chatId];
    if (!msgs) return res.status(404).json({ error: '会话不存在' });
    const msg = msgs.find(m => m.id === msgId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    if (!msg.deletedFor) msg.deletedFor = [];
    if (!msg.deletedFor.includes(username)) msg.deletedFor.push(username);
    saveDB();
    res.json({ success: true });
});

// 批量删除自己的消息（仅自己不可见）
app.post('/api/messages/:chatId/batch-hide', (req, res) => {
    const { chatId } = req.params;
    const { username, msgIds } = req.body;
    if (!Array.isArray(msgIds) || msgIds.length === 0) return res.status(400).json({ error: '未指定消息' });
    const msgs = db.messages[chatId] || [];
    let count = 0;
    for (const msgId of msgIds) {
        const msg = msgs.find(m => m.id === msgId);
        if (msg) {
            if (!msg.deletedFor) msg.deletedFor = [];
            if (!msg.deletedFor.includes(username)) { msg.deletedFor.push(username); count++; }
        }
    }
    saveDB();
    res.json({ success: true, hiddenCount: count });
});

// 转发消息到另一会话
app.post('/api/messages/:chatId/:msgId/forward', (req, res) => {
    const { chatId, msgId } = req.params;
    const { targetChatId, sender } = req.body;
    const senderUser = db.users.find(u => u.username === sender);
    if (!senderUser) return res.status(401).json({ error: '用户不存在' });
    const msgs = db.messages[chatId];
    if (!msgs) return res.status(404).json({ error: '源会话不存在' });
    const origMsg = msgs.find(m => m.id === msgId);
    if (!origMsg) return res.status(404).json({ error: '消息不存在' });
    if (!db.messages[targetChatId]) return res.status(404).json({ error: '目标会话不存在' });
    const forwardedMsg = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        text: origMsg.text, attachments: origMsg.attachments || [],
        alignment: 'left', timestamp: new Date().toISOString(), sender,
        quoteMsg: null, deletedFor: [],
        forwarded: { originalSender: origMsg.sender, originalTime: origMsg.timestamp }
    };
    db.messages[targetChatId].push(forwardedMsg);
    saveDB();
    const allChats = [...db.groups, ...Object.values(db.privateChats)];
    const targetChat = allChats.find(c => c.id === targetChatId);
    if (targetChat) targetChat.members.forEach(m => io.to(`user_${m}`).emit('new_message', { chatId: targetChatId, message: forwardedMsg }));
    res.json({ success: true, message: forwardedMsg });
});

// ========== 管理员 API ==========
// 获取全部用户列表（含权限，仅管理员）
app.get('/api/admin/users', (req, res) => {
    const operator = req.query.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    res.json(db.users.map(u => ({
        username: u.username, nickname: u.nickname,
        banned: u.role === 'banned' || !!u.banned,
        role: u.role || (ADMIN_USERS.includes(u.username) ? 'admin' : 'user'),
        isAdmin: isAdmin(u.username),
        canPost: u.canPost !== false, canMessage: u.canMessage !== false,
        canComment: u.canComment !== false, canCreateGroup: u.canCreateGroup !== false,
        fileSizeLimit: u.fileSizeLimit || 5 * 1024 * 1024
    })));
});

// 设置用户权限（细粒度）
app.put('/api/admin/users/:username/permissions', (req, res) => {
    const operator = req.body.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    const target = db.users.find(u => u.username === req.params.username);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (isAdmin(target.username)) return res.status(400).json({ error: '不能修改管理员权限' });

    const { role, canPost, canMessage, canComment, canCreateGroup, fileSizeLimit } = req.body;
    if (role !== undefined) {
        target.role = role;
        target.banned = (role === 'banned');
    }
    if (canPost !== undefined) target.canPost = canPost;
    if (canMessage !== undefined) target.canMessage = canMessage;
    if (canComment !== undefined) target.canComment = canComment;
    if (canCreateGroup !== undefined) target.canCreateGroup = canCreateGroup;
    if (fileSizeLimit !== undefined) target.fileSizeLimit = fileSizeLimit;
    saveDB();
    res.json({ success: true });
});

// 旧封禁 API 保持兼容
app.put('/api/admin/ban/:username', (req, res) => {
    const operator = req.body.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    const target = db.users.find(u => u.username === req.params.username);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (isAdmin(target.username)) return res.status(400).json({ error: '不能封禁管理员' });
    target.banned = !target.banned;
    target.role = target.banned ? 'banned' : 'user';
    saveDB();
    res.json({ success: true, banned: target.banned, message: target.banned ? '已封禁' : '已解封' });
});

// 删除用户
app.delete('/api/admin/users/:username', (req, res) => {
    const operator = req.body.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    if (isAdmin(req.params.username)) return res.status(400).json({ error: '不能删除管理员' });
    const idx = db.users.findIndex(u => u.username === req.params.username);
    if (idx === -1) return res.status(404).json({ error: '用户不存在' });
    const deletedUser = req.params.username;
    db.users.splice(idx, 1);
    db.posts = db.posts.filter(p => p.author !== deletedUser);
    db.comments = db.comments.filter(c => c.author !== deletedUser);
    db.groups.forEach(g => { g.members = g.members.filter(m => m !== deletedUser); });
    const toDelete = [];
    for (const chatId of Object.keys(db.privateChats)) {
        const chat = db.privateChats[chatId];
        if (chat.members.includes(deletedUser)) {
            toDelete.push(chatId);
            const other = chat.members.find(m => m !== deletedUser);
            if (other) io.to(`user_${other}`).emit('user_deleted', { username: deletedUser, chatId: chat.id });
        }
    }
    toDelete.forEach(id => { delete db.privateChats[id]; delete db.messages[id]; });
    saveDB();
    res.json({ success: true, message: `用户 ${deletedUser} 已删除` });
});

// 管理员删除任意帖子
app.delete('/api/admin/posts/:id', (req, res) => {
    const operator = req.body.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    const postIndex = db.posts.findIndex(p => p.id === req.params.id);
    if (postIndex === -1) return res.status(404).json({ error: '帖子不存在' });
    db.posts.splice(postIndex, 1);
    db.comments = db.comments.filter(c => c.postId !== req.params.id);
    saveDB();
    res.json({ success: true });
});

// 管理员批量删除用户
app.post('/api/admin/users/batch-delete', (req, res) => {
    const { operator, usernames } = req.body;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    if (!Array.isArray(usernames) || usernames.length === 0) return res.status(400).json({ error: '未指定用户' });
    let deletedCount = 0;
    for (const username of usernames) {
        if (isAdmin(username)) continue;
        const idx = db.users.findIndex(u => u.username === username);
        if (idx === -1) continue;
        db.users.splice(idx, 1);
        db.posts = db.posts.filter(p => p.author !== username);
        db.comments = db.comments.filter(c => c.author !== username);
        db.groups.forEach(g => { g.members = g.members.filter(m => m !== username); });
        const toDelete = [];
        for (const chatId of Object.keys(db.privateChats)) {
            const chat = db.privateChats[chatId];
            if (chat.members.includes(username)) {
                toDelete.push(chatId);
                const other = chat.members.find(m => m !== username);
                if (other) io.to(`user_${other}`).emit('user_deleted', { username, chatId: chat.id });
            }
        }
        toDelete.forEach(id => { delete db.privateChats[id]; delete db.messages[id]; });
        deletedCount++;
    }
    saveDB();
    res.json({ success: true, deletedCount });
});

// ========== 通知 API ==========
app.get('/api/notifications/:username', (req, res) => {
    if (!db.notifications) db.notifications = [];
    const notifs = db.notifications
        .filter(n => n.to === req.params.username)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50);
    res.json(notifs);
});

app.post('/api/notifications/read', (req, res) => {
    const { username, notifId } = req.body;
    if (!db.notifications) return res.json({ success: true });
    if (notifId === 'all') {
        db.notifications.filter(n => n.to === username).forEach(n => { n.read = true; });
    } else {
        const notif = db.notifications.find(n => n.id === notifId && n.to === username);
        if (notif) notif.read = true;
    }
    saveDB();
    res.json({ success: true });
});

// ========== 举报 API ==========
app.post('/api/reports', (req, res) => {
    const { reporter, targetUser, targetPost, reason } = req.body;
    if (!reason || !reporter) return res.status(400).json({ error: '缺少参数' });
    db.reports.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        reporter, targetUser: targetUser || null, targetPost: targetPost || null,
        reason, status: 'pending', createdAt: Date.now()
    });
    saveDB();
    res.json({ success: true });
});

// 管理员查看举报列表
app.get('/api/admin/reports', (req, res) => {
    const operator = req.query.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    res.json((db.reports || []).sort((a, b) => b.createdAt - a.createdAt));
});

// 管理员处理举报
app.put('/api/admin/reports/:id', (req, res) => {
    const operator = req.body.operator;
    if (!isAdmin(operator)) return res.status(403).json({ error: '无权操作' });
    const report = db.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: '举报不存在' });
    report.status = req.body.status || 'resolved';
    report.handledAt = Date.now();
    report.handledBy = operator;
    saveDB();
    res.json({ success: true });
});

// ========== 好友系统 API ==========
// 获取好友列表
app.get('/api/friends/:username', (req, res) => {
    const friends = (db.friends || {})[req.params.username] || [];
    const friendData = friends.map(f => {
        const u = db.users.find(u => u.username === f);
        return u ? { username: u.username, nickname: u.nickname, avatar: u.avatar || '', bio: u.bio || '' } : null;
    }).filter(Boolean);
    res.json(friendData);
});

// 发送好友申请
app.post('/api/friends/request', (req, res) => {
    const { from, to } = req.body;
    if (!db.users.find(u => u.username === from)) return res.status(404).json({ error: '发起人不存在' });
    if (!db.users.find(u => u.username === to)) return res.status(404).json({ error: '目标用户不存在' });
    if (from === to) return res.status(400).json({ error: '不能添加自己为好友' });
    if (!db.friends) db.friends = {};
    if ((db.friends[from] || []).includes(to)) return res.status(400).json({ error: '已经是好友了' });
    if (!db.friendRequests) db.friendRequests = [];
    const existing = db.friendRequests.find(r => r.from === from && r.to === to && r.status === 'pending');
    if (existing) return res.status(400).json({ error: '已发送过申请，等待对方同意' });
    const req_ = { id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        from, to, status: 'pending', createdAt: Date.now() };
    db.friendRequests.push(req_);
    saveDB();
    const fromUser = db.users.find(u => u.username === from);
    createNotification(to, 'friend_request', {
        requestId: req_.id, fromUser: from,
        fromNickname: fromUser ? fromUser.nickname : from
    });
    res.json({ success: true });
});

// 获取收到的好友申请
app.get('/api/friends/requests/:username', (req, res) => {
    const requests = (db.friendRequests || []).filter(r => r.to === req.params.username && r.status === 'pending');
    res.json(requests.map(r => {
        const fromUser = db.users.find(u => u.username === r.from);
        return { ...r, fromNickname: fromUser ? fromUser.nickname : r.from, fromAvatar: fromUser ? fromUser.avatar || '' : '' };
    }));
});

// 处理好友申请（接受/拒绝）
app.put('/api/friends/requests/:id', (req, res) => {
    const { action, username } = req.body; // action: 'accept' | 'reject'
    if (!db.friendRequests) return res.status(404).json({ error: '申请不存在' });
    const reqObj = db.friendRequests.find(r => r.id === req.params.id && r.to === username);
    if (!reqObj) return res.status(404).json({ error: '申请不存在' });
    reqObj.status = action === 'accept' ? 'accepted' : 'rejected';
    if (action === 'accept') {
        if (!db.friends) db.friends = {};
        if (!db.friends[reqObj.from]) db.friends[reqObj.from] = [];
        if (!db.friends[reqObj.to]) db.friends[reqObj.to] = [];
        if (!db.friends[reqObj.from].includes(reqObj.to)) db.friends[reqObj.from].push(reqObj.to);
        if (!db.friends[reqObj.to].includes(reqObj.from)) db.friends[reqObj.to].push(reqObj.from);
        const toUser = db.users.find(u => u.username === reqObj.to);
        createNotification(reqObj.from, 'friend_accepted', {
            byUser: reqObj.to, byNickname: toUser ? toUser.nickname : reqObj.to
        });
    }
    saveDB();
    res.json({ success: true, action });
});

// 删除好友
app.delete('/api/friends/:username/:friend', (req, res) => {
    const { username, friend } = req.params;
    if (!db.friends) return res.json({ success: true });
    db.friends[username] = (db.friends[username] || []).filter(f => f !== friend);
    db.friends[friend] = (db.friends[friend] || []).filter(f => f !== username);
    saveDB();
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
    const htmlFile = fs.existsSync(publicDir) ? path.join(publicDir, 'index.html') : rootHtml;
    res.sendFile(htmlFile);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { console.log(`LN Chat running on port ${PORT}`); });
