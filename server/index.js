const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

// 1. CẤU HÌNH ĐƯỜNG DẪN TĨNH
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Route mặc định
app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

// 2. LƯU TRỮ TẠM THÔNG TIN NGƯỜI DÙNG
const users = new Map(); // Map<socketID, {userName, roomID}>

// 3. LOGIC SOCKET.IO
io.on('connection', (socket) => {
    console.log('🔗 Thiết bị kết nối:', socket.id);

    // --- A. QUẢN LÝ VÀO PHÒNG ---
    socket.on('join-room', async (data) => {
        const { roomID, userName, action } = data;
        
        // Kiểm tra phòng đã tồn tại chưa
        const roomExists = io.sockets.adapter.rooms.has(roomID);

        // Nếu muốn 'join' mà phòng chưa có -> Báo lỗi
        if (action === 'join' && !roomExists) {
            socket.emit('room-error', '❌ Mã phòng không tồn tại hoặc cuộc họp đã kết thúc!');
            return; 
        }

        // Lưu thông tin người dùng
        users.set(socket.id, { userName, roomID });
        socket.userName = userName;
        socket.roomID = roomID;

        // Join room
        socket.join(roomID);
        
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
            participants 
        });

        console.log(`✅ User [${userName}] đã vào phòng: ${roomID} | Action: ${action}`);

        // Thông báo cho người cũ trong phòng biết có người mới
        socket.to(roomID).emit('user-joined', { 
            socketID: socket.id, 
            userName: userName 
        });
    });

    // --- B. TÍN HIỆU VIDEO CALL (WebRTC) ---
    socket.on('signal', (signalData) => {
        const userInfo = users.get(socket.id);
        if (!userInfo) return;
        
        const roomID = userInfo.roomID;
        signalData.fromSocketID = socket.id;
        signalData.fromName = socket.userName;
        
        socket.to(roomID).emit('signal', signalData);
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

    // --- D. TÍNH NĂNG CHAT ---
    socket.on('chat-message', (data) => {
        const userInfo = users.get(socket.id);
        if (!userInfo) return;
        
        socket.to(userInfo.roomID).emit('chat-message', {
            userName: userInfo.userName,
            text: data.text
        });
    });

    // --- E. NGẮT KẾT NỐI ---
    socket.on('disconnect', () => {
        console.log('❌ Người dùng ngắt kết nối:', socket.id);
        
        const userInfo = users.get(socket.id);
        if (userInfo) {
            const { userName, roomID } = userInfo;
            
            // Thông báo cho người khác trong phòng
            socket.to(roomID).emit('user-left', {
                socketID: socket.id,
                userName: userName
            });
            
            // Xóa khỏi bộ nhớ
            users.delete(socket.id);
            
            console.log(`👋 [${userName}] đã rời phòng ${roomID}`);
        }
    });
});

// 4. KHỞI CHẠY SERVER
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('==============================================');
    console.log(`🚀 SERVER E4LIFE ĐANG CHẠY TẠI: http://localhost:${PORT}`);
    console.log('   - Video Call P2P: Sẵn sàng');
    console.log('   - Bảng trắng: Sẵn sàng');
    console.log('   - Chat Realtime: Sẵn sàng');
    console.log('   - Danh sách người tham gia: Sẵn sàng');
    console.log('==============================================');
});