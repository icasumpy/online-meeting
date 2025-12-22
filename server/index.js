const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

// 1. CẤU HÌNH ĐƯỜNG DẪN TĨNH
// Trỏ ra folder 'client' nằm cùng cấp với folder 'server'
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Route mặc định trả về file index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

// 2. LOGIC SOCKET.IO
io.on('connection', (socket) => {
    console.log('🔗 Thiết bị kết nối:', socket.id);

    // --- A. QUẢN LÝ VÀO PHÒNG ---
    socket.on('join-room', (data) => {
        const { roomID, userName, action } = data;
        
        // Kiểm tra phòng đã tồn tại chưa
        const roomExists = io.sockets.adapter.rooms.has(roomID);

        // LOGIC KIỂM TRA:
        // Nếu muốn 'join' (tham gia) mà phòng chưa có -> Báo lỗi
        if (action === 'join' && !roomExists) {
            socket.emit('room-error', '❌ Mã phòng không tồn tại hoặc cuộc họp đã kết thúc!');
            return; 
        }

        // Nếu hợp lệ (Tạo mới hoặc Tham gia đúng mã)
        socket.join(roomID);
        
        // Gửi thông báo thành công cho người gọi để họ chuyển màn hình
        socket.emit('room-success', roomID);

        console.log(`✅ User [${userName}] đã vào phòng: ${roomID} | Action: ${action}`);

        // Thông báo cho người cũ trong phòng biết có người mới
        socket.to(roomID).emit('user-joined', { 
            socketID: socket.id, 
            userName: userName 
        });
    });

    // --- B. TÍN HIỆU VIDEO CALL (WebRTC) ---
    // Chuyển tiếp các gói tin Offer, Answer, Candidate giữa các thiết bị
    socket.on('signal', (signalData) => {
        // Lấy room của socket hiện tại
        const rooms = Array.from(socket.rooms);
        const roomID = rooms.find(r => r !== socket.id); // RoomID không phải là socket.id

        if (roomID) {
            socket.to(roomID).emit('signal', signalData);
        }
    });

    // --- C. ĐỒNG BỘ BẢNG TRẮNG ---
    // 1. Vẽ nét
    socket.on('draw-line', (drawData) => {
        const rooms = Array.from(socket.rooms);
        const roomID = rooms.find(r => r !== socket.id);
        if (roomID) socket.to(roomID).emit('draw-line', drawData);
    });

    // 2. Viết chữ
    socket.on('draw-text', (drawData) => {
        const rooms = Array.from(socket.rooms);
        const roomID = rooms.find(r => r !== socket.id);
        if (roomID) socket.to(roomID).emit('draw-text', drawData);
    });

    // 3. Xóa bảng
    socket.on('clear-board', () => {
        const rooms = Array.from(socket.rooms);
        const roomID = rooms.find(r => r !== socket.id);
        if (roomID) socket.to(roomID).emit('clear-board');
    });

    // --- D. TÍNH NĂNG CHAT ---
    socket.on('chat-message', (data) => {
        const { roomID, userName, text } = data;
        // Gửi tin nhắn cho những người khác trong phòng
        socket.to(roomID).emit('chat-message', {
            userName: userName,
            text: text
        });
    });

    // --- E. NGẮT KẾT NỐI ---
    socket.on('disconnect', () => {
        console.log('❌ Một người dùng đã ngắt kết nối:', socket.id);
        // Có thể thêm logic thông báo user đã rời phòng nếu cần
    });
});

// 3. KHỞI CHẠY SERVER
const PORT = 3000;
http.listen(PORT, () => {
    console.log('==============================================');
    console.log(`🚀 SERVER E4LIFE ĐANG CHẠY TẠI: http://localhost:${PORT}`);
    console.log('   - Video Call P2P: Sẵn sàng');
    console.log('   - Bảng trắng: Sẵn sàng');
    console.log('   - Chat Realtime: Sẵn sàng');
    console.log('==============================================');
});