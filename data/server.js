const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ========== 修复 pkg 打包后的路径问题 ==========
// 使用 process.cwd() 获取 .exe 所在目录，而不是 __dirname
const DATA_DIR = path.join(process.cwd(), 'data');

// ========== 前端页面托管 ==========
// index.html 放在 exe 同级目录，通过浏览器访问 http://本机IP:3000 即可使用
app.get('/', (req, res) => {
    const htmlPath = path.join(process.cwd(), 'index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).send('找不到 index.html，请确保它与 LN.exe 在同一目录下。');
    }
});
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const PRIVATE_CHATS_FILE = path.join(DATA_DIR, 'privateChats.json');
const GROUP_NICKNAMES_FILE = path.join(DATA_DIR, 'groupNicknames.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

// 确保数据目录存在（在 .exe 同级目录下创建）
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 读写辅助函数
function readJson(file, defaultVal = []) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        return defaultVal;
    } catch (err) {
        console.error(`读取文件失败 ${file}:`, err);
        return defaultVal;
    }
}

function writeJson(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`写入文件失败 ${file}:`, err);
    }
}

// 初始化数据文件（如果不存在则创建）
function initDataFiles() {
    if (!fs.existsSync(USERS_FILE)) writeJson(USERS_FILE, []);
    if (!fs.existsSync(GROUPS_FILE)) writeJson(GROUPS_FILE, []);
    if (!fs.existsSync(MESSAGES_FILE)) writeJson(MESSAGES_FILE, {});
    if (!fs.existsSync(PRIVATE_CHATS_FILE)) writeJson(PRIVATE_CHATS_FILE, {});
    if (!fs.existsSync(GROUP_NICKNAMES_FILE)) writeJson(GROUP_NICKNAMES_FILE, {});
    if (!fs.existsSync(POSTS_FILE)) writeJson(POSTS_FILE, []);
    if (!fs.existsSync(COMMENTS_FILE)) writeJson(COMMENTS_FILE, []);
    if (!fs.existsSync(REPORTS_FILE)) writeJson(REPORTS_FILE, []);
}
initDataFiles();

// 管理员列表
const ADMIN_USERS = ['admin'];

// ========== 辅助函数 ==========
function getPrivateChatId(userA, userB) {
    return `private_${userA}_${userB}`;
}

function ensurePrivateChat(userA, userB) {
    const id1 = getPrivateChatId(userA, userB);
    const id2 = getPrivateChatId(userB, userA);
    let privateChats = readJson(PRIVATE_CHATS_FILE, {});
    let chat = privateChats[id1] || privateChats[id2];
    if (!chat) {
        chat = {
            id: id1,
            name: `${userA} 和 ${userB} 的私聊`,
            type: 'private',
            members: [userA, userB],
            created: Date.now()
        };
        privateChats[id1] = chat;
        writeJson(PRIVATE_CHATS_FILE, privateChats);
        
        const messages = readJson(MESSAGES_FILE, {});
        messages[chat.id] = [];
        writeJson(MESSAGES_FILE, messages);
    }
    return chat;
}

// ========== 用户相关 ==========
app.post('/api/register', (req, res) => {
    const { username, nickname, password } = req.body;
    const users = readJson(USERS_FILE);
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    users.push({ username, nickname, password, bio: '' });
    writeJson(USERS_FILE, users);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readJson(USERS_FILE);
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, nickname: user.nickname });
    } else {
        res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
});

app.get('/api/users', (req, res) => {
    const users = readJson(USERS_FILE);
    res.json(users.map(u => ({ username: u.username, nickname: u.nickname, bio: u.bio || '' })));
});

app.get('/api/users/:username', (req, res) => {
    const { username } = req.params;
    const users = readJson(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ username: user.username, nickname: user.nickname, bio: user.bio || '' });
});

app.put('/api/users/:username', (req, res) => {
    const { username } = req.params;
    const { nickname, bio } = req.body;
    const users = readJson(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (nickname) user.nickname = nickname;
    if (bio !== undefined) user.bio = bio;
    writeJson(USERS_FILE, users);
    res.json({ success: true, nickname: user.nickname, bio: user.bio });
});

app.get('/api/users/:username/liked-posts', (req, res) => {
    const { username } = req.params;
    const posts = readJson(POSTS_FILE);
    const likedPosts = posts.filter(p => p.likes && p.likes.includes(username));
    const users = readJson(USERS_FILE);
    const enriched = likedPosts.map(p => {
        const author = users.find(u => u.username === p.author);
        return {
            ...p,
            authorNickname: author ? author.nickname : p.author,
            likeCount: p.likes ? p.likes.length : 0,
            favoriteCount: p.favorites ? p.favorites.length : 0,
            commentCount: readJson(COMMENTS_FILE).filter(c => c.postId === p.id).length
        };
    });
    res.json(enriched.reverse());
});

app.get('/api/users/:username/favorited-posts', (req, res) => {
    const { username } = req.params;
    const posts = readJson(POSTS_FILE);
    const favoritedPosts = posts.filter(p => p.favorites && p.favorites.includes(username));
    const users = readJson(USERS_FILE);
    const enriched = favoritedPosts.map(p => {
        const author = users.find(u => u.username === p.author);
        return {
            ...p,
            authorNickname: author ? author.nickname : p.author,
            likeCount: p.likes ? p.likes.length : 0,
            favoriteCount: p.favorites ? p.favorites.length : 0,
            commentCount: readJson(COMMENTS_FILE).filter(c => c.postId === p.id).length
        };
    });
    res.json(enriched.reverse());
});

// ========== 群组和私聊 ==========
app.get('/api/chats/:username', (req, res) => {
    const { username } = req.params;
    const groups = readJson(GROUPS_FILE).filter(g => g.members.includes(username));
    const privateChats = readJson(PRIVATE_CHATS_FILE, {});
    const userPrivateChats = Object.values(privateChats).filter(c => c.members.includes(username));
    res.json([...groups, ...userPrivateChats]);
});

app.get('/api/messages/:chatId', (req, res) => {
    const { chatId } = req.params;
    const messages = readJson(MESSAGES_FILE, {});
    res.json(messages[chatId] || []);
});

app.post('/api/messages/:chatId', (req, res) => {
    const { chatId } = req.params;
    const { text, attachments, alignment, sender } = req.body;
    const messages = readJson(MESSAGES_FILE, {});
    if (!messages[chatId]) messages[chatId] = [];
    const newMsg = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        text,
        attachments,
        alignment,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' }),
        sender
    };
    messages[chatId].push(newMsg);
    writeJson(MESSAGES_FILE, messages);
    
    const allChats = [...readJson(GROUPS_FILE), ...Object.values(readJson(PRIVATE_CHATS_FILE, {}))];
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
    const groups = readJson(GROUPS_FILE);
    const newId = 'group_' + Date.now();
    const newGroup = {
        id: newId,
        name,
        type: 'group',
        creator,
        members: [creator],
        created: Date.now()
    };
    groups.push(newGroup);
    writeJson(GROUPS_FILE, groups);
    const messages = readJson(MESSAGES_FILE, {});
    messages[newId] = [];
    writeJson(MESSAGES_FILE, messages);
    res.json(newGroup);
});

app.put('/api/groups/:id', (req, res) => {
    const { id } = req.params;
    const { name, operator } = req.body;
    const groups = readJson(GROUPS_FILE);
    const group = groups.find(g => g.id === id);
    if (!group || group.creator !== operator) return res.status(403).json({ success: false });
    group.name = name;
    writeJson(GROUPS_FILE, groups);
    group.members.forEach(m => io.to(`user_${m}`).emit('group_updated', { groupId: id, newName: name }));
    res.json({ success: true });
});

app.post('/api/groups/:id/members', (req, res) => {
    const { id } = req.params;
    const { username, operator } = req.body;
    const groups = readJson(GROUPS_FILE);
    const group = groups.find(g => g.id === id);
    if (!group) return res.status(404).json({ success: false, message: '群组不存在' });
    if (group.creator !== operator) return res.status(403).json({ success: false, message: '仅群主可添加成员' });
    if (group.members.includes(username)) return res.status(400).json({ success: false, message: '用户已在群中' });
    const users = readJson(USERS_FILE);
    if (!users.find(u => u.username === username)) return res.status(404).json({ success: false, message: '用户不存在' });
    group.members.push(username);
    writeJson(GROUPS_FILE, groups);
    group.members.forEach(m => io.to(`user_${m}`).emit('group_member_added', { groupId: id, newMember: username }));
    res.json({ success: true, members: group.members });
});

app.get('/api/chats/:chatId/members', (req, res) => {
    const { chatId } = req.params;
    const allChats = [...readJson(GROUPS_FILE), ...Object.values(readJson(PRIVATE_CHATS_FILE, {}))];
    const chat = allChats.find(c => c.id === chatId);
    if (!chat) return res.status(404).json([]);
    const users = readJson(USERS_FILE);
    const nicknames = readJson(GROUP_NICKNAMES_FILE, {});
    const members = chat.members.map(username => {
        const user = users.find(u => u.username === username);
        const globalNickname = user ? user.nickname : username;
        const groupNickname = (nicknames[chatId] || {})[username] || '';
        return {
            username,
            globalNickname,
            groupNickname,
            displayName: groupNickname || globalNickname
        };
    });
    res.json(members);
});

app.post('/api/chats/:chatId/nickname', (req, res) => {
    const { chatId } = req.params;
    const { username, nickname } = req.body;
    const nicknames = readJson(GROUP_NICKNAMES_FILE, {});
    if (!nicknames[chatId]) nicknames[chatId] = {};
    nicknames[chatId][username] = nickname;
    writeJson(GROUP_NICKNAMES_FILE, nicknames);
    res.json({ success: true });
});

app.post('/api/private', (req, res) => {
    const { userA, userB } = req.body;
    const chat = ensurePrivateChat(userA, userB);
    res.json(chat);
});

// ========== 帖子相关 ==========
app.get('/api/posts', (req, res) => {
    const posts = readJson(POSTS_FILE);
    const users = readJson(USERS_FILE);
    const comments = readJson(COMMENTS_FILE);
    const postsWithUser = posts.map(post => {
        const user = users.find(u => u.username === post.author);
        return {
            ...post,
            authorNickname: user ? user.nickname : post.author,
            likeCount: post.likes ? post.likes.length : 0,
            favoriteCount: post.favorites ? post.favorites.length : 0,
            commentCount: comments.filter(c => c.postId === post.id).length
        };
    });
    res.json(postsWithUser.reverse());
});

app.get('/api/posts/:id', (req, res) => {
    const { id } = req.params;
    const posts = readJson(POSTS_FILE);
    const post = posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    const users = readJson(USERS_FILE);
    const user = users.find(u => u.username === post.author);
    const allComments = readJson(COMMENTS_FILE);
    const comments = allComments.filter(c => c.postId === id).sort((a,b) => a.createdAt - b.createdAt);
    const commentsWithUser = comments.map(c => {
        const commentUser = users.find(u => u.username === c.author);
        return { ...c, authorNickname: commentUser ? commentUser.nickname : c.author };
    });
    res.json({
        ...post,
        authorNickname: user ? user.nickname : post.author,
        likeCount: post.likes ? post.likes.length : 0,
        favoriteCount: post.favorites ? post.favorites.length : 0,
        comments: commentsWithUser
    });
});

app.post('/api/posts', (req, res) => {
    const { title, content, author } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const users = readJson(USERS_FILE);
    if (!users.find(u => u.username === author)) return res.status(401).json({ error: '用户未登录' });
    const posts = readJson(POSTS_FILE);
    const newPost = {
        id: Date.now().toString(),
        title,
        content,
        author,
        createdAt: Date.now(),
        views: 0,
        likes: [],
        favorites: []
    };
    posts.push(newPost);
    writeJson(POSTS_FILE, posts);
    res.json(newPost);
});

app.post('/api/posts/:id/view', (req, res) => {
    const { id } = req.params;
    const posts = readJson(POSTS_FILE);
    const post = posts.find(p => p.id === id);
    if (post) {
        post.views = (post.views || 0) + 1;
        writeJson(POSTS_FILE, posts);
        res.json({ success: true, views: post.views });
    } else {
        res.status(404).json({ error: '帖子不存在' });
    }
});

app.post('/api/posts/:id/like', (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    const posts = readJson(POSTS_FILE);
    const post = posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!post.likes) post.likes = [];
    const index = post.likes.indexOf(username);
    if (index === -1) {
        post.likes.push(username);
    } else {
        post.likes.splice(index, 1);
    }
    writeJson(POSTS_FILE, posts);
    res.json({ success: true, liked: index === -1, likeCount: post.likes.length });
});

app.post('/api/posts/:id/favorite', (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    const posts = readJson(POSTS_FILE);
    const post = posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (!post.favorites) post.favorites = [];
    const index = post.favorites.indexOf(username);
    if (index === -1) {
        post.favorites.push(username);
    } else {
        post.favorites.splice(index, 1);
    }
    writeJson(POSTS_FILE, posts);
    res.json({ success: true, favorited: index === -1, favoriteCount: post.favorites.length });
});

app.post('/api/posts/:id/comments', (req, res) => {
    const { id } = req.params;
    const { content, author } = req.body;
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });
    const users = readJson(USERS_FILE);
    if (!users.find(u => u.username === author)) return res.status(401).json({ error: '用户未登录' });
    const comments = readJson(COMMENTS_FILE);
    const newComment = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        postId: id,
        content,
        author,
        createdAt: Date.now()
    };
    comments.push(newComment);
    writeJson(COMMENTS_FILE, comments);
    res.json(newComment);
});

app.delete('/api/posts/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.body; // 操作者用户名
    const posts = readJson(POSTS_FILE);
    const postIndex = posts.findIndex(p => p.id === id);
    if (postIndex === -1) return res.status(404).json({ error: '帖子不存在' });
    const post = posts[postIndex];
    const isAuthor = post.author === username;
    const isAdmin = ADMIN_USERS.includes(username);
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: '无权删除' });
    posts.splice(postIndex, 1);
    writeJson(POSTS_FILE, posts);
    // 删除帖子下的所有评论
    let comments = readJson(COMMENTS_FILE);
    comments = comments.filter(c => c.postId !== id);
    writeJson(COMMENTS_FILE, comments);
    res.json({ success: true });
});

app.post('/api/posts/:id/report', (req, res) => {
    const { id } = req.params;
    const { reason, reporter } = req.body;
    let reports = readJson(REPORTS_FILE, []);
    reports.push({ postId: id, reason, reporter, createdAt: Date.now() });
    writeJson(REPORTS_FILE, reports);
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
        if (currentUser) {
            socket.broadcast.emit('user_offline', currentUser);
        }
    });
});

// ========== 启动服务器 ==========
const os = require('os');
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    // 获取局域网 IP
    const nets = os.networkInterfaces();
    let lanIP = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                lanIP = net.address;
                break;
            }
        }
        if (lanIP !== 'localhost') break;
    }
    console.log('===========================================');
    console.log(`  LN 聊天服务已启动！`);
    console.log(`  本机访问:  http://localhost:${PORT}`);
    console.log(`  局域网访问: http://${lanIP}:${PORT}`);
    console.log(`  数据目录:  ${DATA_DIR}`);
    console.log('===========================================');
});