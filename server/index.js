const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});
const path = require('path');

// 1. CẤU HÌNH ĐƯỜNG DẪN TĨNH
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Tăng giới hạn kích thước file upload
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Route mặc định
app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

// Route kiểm tra server
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        connections: io.engine.clientsCount
    });
});

// 2. LƯU TRỮ TẠM THÔNG TIN NGƯỜI DÙNG
const users = new Map(); // Map<socketID, {userName, roomID}>
const rooms = new Map(); // Map<roomID, Set<socketID>>

// 3. LOGIC SOCKET.IO
io.on('connection', (socket) => {
    console.log('🔗 Thiết bị kết nối:', socket.id, '| Tổng kết nối:', io.engine.clientsCount);

    // Gửi sự kiện kết nối thành công
    socket.emit('connected', { 
        socketID: socket.id, 
        message: 'Kết nối thành công',
        timestamp: new Date().toISOString()
    });

    // --- A. QUẢN LÝ VÀO PHÒNG ---
    socket.on('join-room', async (data) => {
        const { roomID, userName, action } = data;
        
        // Kiểm tra dữ liệu đầu vào
        if (!roomID || !userName) {
            socket.emit('room-error', 'Thiếu thông tin phòng hoặc tên người dùng');
            return;
        }

        // Kiểm tra phòng đã tồn tại chưa
        const roomExists = io.sockets.adapter.rooms.has(roomID);

        // Nếu muốn 'join' mà phòng chưa có -> Báo lỗi
        if (action === 'join' && !roomExists) {
            socket.emit('room-error', '❌ Mã phòng không tồn tại hoặc cuộc họp đã kết thúc!');
            return; 
        }

        // Nếu đang ở phòng khác, rời phòng cũ
        const oldRoom = socket.roomID;
        if (oldRoom && oldRoom !== roomID) {
            socket.leave(oldRoom);
            socket.to(oldRoom).emit('user-left', {
                socketID: socket.id,
                userName: socket.userName || 'Ẩn danh'
            });
            
            // Cập nhật rooms map
            if (rooms.has(oldRoom)) {
                rooms.get(oldRoom).delete(socket.id);
                if (rooms.get(oldRoom).size === 0) {
                    rooms.delete(oldRoom);
                }
            }
        }

        // Lưu thông tin người dùng
        users.set(socket.id, { userName, roomID });
        socket.userName = userName;
        socket.roomID = roomID;

        // Quản lý rooms map
        if (!rooms.has(roomID)) {
            rooms.set(roomID, new Set());
        }
        rooms.get(roomID).add(socket.id);

        // Join room
        await socket.join(roomID);
        
        // Lấy danh sách người hiện có trong phòng
        const roomSockets = await io.in(roomID).fetchSockets();
        const participants = roomSockets
            .filter(s => s.id !== socket.id)
            .map(s => ({
                socketID: s.id,
                userName: s.userName || 'Ẩn danh'
            }));
        
        // Gửi thông báo thành công và danh sách hiện tại
        socket.emit('room-success', { 
            roomID, 
            participants,
            socketID: socket.id,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ User [${userName}] đã vào phòng: ${roomID} | Action: ${action} | Số người trong phòng: ${roomSockets.length}`);

        // Thông báo cho người cũ trong phòng biết có người mới
        socket.to(roomID).emit('user-joined', { 
            socketID: socket.id, 
            userName: userName,
            timestamp: new Date().toISOString()
        });
    });

    // --- B. TÍN HIỆU VIDEO CALL (WebRTC) ---
    socket.on('signal', (signalData) => {
        const userInfo = users.get(socket.id);
        if (!userInfo) return;
        
        const roomID = userInfo.roomID;
        const targetRoom = signalData.roomID || roomID;
        
        // Thêm thông tin người gửi
        signalData.fromSocketID = socket.id;
        signalData.fromName = socket.userName;
        
        console.log(`📡 Signal từ ${socket.userName} đến phòng ${targetRoom}`, signalData.type || 'candidate');
        
        // Gửi đến tất cả trong phòng (hoặc phòng chỉ định)
        if (signalData.toSocketID) {
            // Gửi đến người cụ thể
            io.to(signalData.toSocketID).emit('signal', signalData);
        } else {
            // Gửi đến tất cả trong phòng (trừ chính mình)
            socket.to(targetRoom).emit('signal', signalData);
        }
    });

    // --- C. ĐỒNG BỘ BẢNG TRẮNG ---
    socket.on('draw-line', (drawData) => {
        const userInfo = users.get(socket.id);
        if (userInfo) {
            socket.to(userInfo.roomID).emit('draw-line', drawData);
        }
    });

    socket.on('draw-text', (drawData) => {
        const userInfo = users.get(socket.id);
        if (userInfo) {
            socket.to(userInfo.roomID).emit('draw-text', drawData);
        }
    });

    socket.on('clear-board', () => {
        const userInfo = users.get(socket.id);
        if (userInfo) {
            socket.to(userInfo.roomID).emit('clear-board');
        }
    });

    socket.on('request-board-snapshot', async ({ roomID, fromSocketID }) => {
        // Gửi yêu cầu snapshot đến tất cả mọi người trong phòng
        io.to(roomID).emit('request-board-snapshot', { fromSocketID });
    });

    socket.on('send-board-snapshot', ({ toSocketID, imageData }) => {
        // Gửi snapshot bảng đến người yêu cầu
        io.to(toSocketID).emit('receive-board-snapshot', { imageData });
    });

    // --- D. TÍNH NĂNG CHAT NÂNG CAO ---
    socket.on('chat-message', (data) => {
        const userInfo = users.get(socket.id);
        if (!userInfo) return;
        
        // Tin nhắn thông thường - gửi đến cả phòng
        socket.to(userInfo.roomID).emit('chat-message', {
            userName: userInfo.userName,
            text: data.text,
            type: 'text',
            timestamp: new Date().toISOString(),
            socketID: socket.id
        });
    });

    // Tin nhắn file/hình ảnh
    socket.on('chat-file', (data) => {
        const userInfo = users.get(socket.id);
        if (!userInfo) return;
        
        console.log(`📁 File từ ${userInfo.userName}: ${data.fileName} (${data.fileSize} bytes)`);
        
        socket.to(userInfo.roomID).emit('chat-message', {
            userName: userInfo.userName,
            fileName: data.fileName,
            fileType: data.fileType,
            fileSize: data.fileSize,
            fileData: data.fileData, // Base64 encoded
            type: 'file',
            timestamp: new Date().toISOString(),
            socketID: socket.id
        });
    });

    // Tin nhắn riêng
    socket.on('private-message', ({ toSocketID, text }) => {
        const userInfo = users.get(socket.id);
        if (!userInfo) return;

        console.log(`🔒 Tin nhắn riêng từ ${userInfo.userName} đến ${toSocketID}`);

        // Gửi tin nhắn đến người nhận cụ thể
        io.to(toSocketID).emit('private-message', {
            fromSocketID: socket.id,
            fromName: userInfo.userName,
            text,
            timestamp: new Date().toISOString()
        });

        // Gửi xác nhận cho người gửi
        socket.emit('private-message-sent', { toSocketID });
    });

    // Yêu cầu rời phòng
    socket.on('leave-room', ({ roomID }) => {
        if (socket.roomID === roomID) {
            socket.leave(roomID);
            
            const userName = socket.userName || 'Ẩn danh';
            socket.to(roomID).emit('user-left', {
                socketID: socket.id,
                userName: userName
            });
            
            console.log(`🚪 [${userName}] đã rời phòng ${roomID}`);
        }
    });

    // Ping/Pong để kiểm tra kết nối
    socket.on('ping', (data) => {
        socket.emit('pong', { ...data, timestamp: new Date().toISOString() });
    });

    // --- E. NGẮT KẾT NỐI ---
    socket.on('disconnect', (reason) => {
        console.log('❌ Người dùng ngắt kết nối:', socket.id, '| Lý do:', reason);
        
        const userInfo = users.get(socket.id);
        if (userInfo) {
            const { userName, roomID } = userInfo;
            
            // Xóa khỏi rooms map
            if (rooms.has(roomID)) {
                rooms.get(roomID).delete(socket.id);
                if (rooms.get(roomID).size === 0) {
                    rooms.delete(roomID);
                }
            }
            
            // Thông báo cho người khác trong phòng
            socket.to(roomID).emit('user-left', {
                socketID: socket.id,
                userName: userName
            });
            
            // Xóa khỏi bộ nhớ
            users.delete(socket.id);
            
            console.log(`👋 [${userName}] đã rời phòng ${roomID} (disconnect)`);
        }
    });

    // Xử lý lỗi
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// 4. KHỞI CHẠY SERVER
const PORT = process.env.PORT || 3000;

// Xử lý sự kiện server
http.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} đang được sử dụng, thử port ${PORT + 1}...`);
        http.listen(PORT + 1);
    } else {
        console.error('Server error:', error);
    }
});

http.listen(PORT, () => {
    console.log('==============================================');
    console.log(`🚀 SERVER E4LIFE ĐANG CHẠY TẠI: http://localhost:${PORT}`);
    console.log(`   - Địa chỉ LAN: http://${getLocalIP()}:${PORT}`);
    console.log('   - Video Call P2P: Sẵn sàng (LAN/Wifi)');
    console.log('   - Bảng trắng: Sẵn sàng (có export)');
    console.log('   - Chat Realtime: Sẵn sàng (file + tin nhắn riêng)');
    console.log('   - Danh sách người tham gia: Sẵn sàng');
    console.log('   - Share Screen: Sẵn sàng');
    console.log('==============================================');
    console.log('📱 Để kết nối từ thiết bị khác trong mạng LAN:');
    console.log(`   1. Mở trình duyệt trên thiết bị khác`);
    console.log(`   2. Truy cập: http://${getLocalIP()}:${PORT}`);
    console.log(`   3. Nhập cùng mã phòng và tên người dùng`);
    console.log('==============================================');
});

// Hàm lấy địa chỉ IP local
function getLocalIP() {
    const interfaces = require('os').networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (const alias of iface) {
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

// Middleware xử lý lỗi 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(clientPath, 'index.html'));
});

// Xử lý lỗi toàn cục
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});