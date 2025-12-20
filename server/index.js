const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

// 1. Cấu hình đường dẫn: Trỏ từ folder server ra ngoài folder client
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

// 2. Logic kết nối Socket.io
io.on('connection', (socket) => {
    console.log('Thiết bị mới kết nối:', socket.id);

    // Xử lý khi người dùng tham gia vào phòng kèm theo Tên người dùng
    socket.on('join-room', (data) => {
        const { roomID, userName } = data; // Nhận mã phòng và tên từ client
        socket.join(roomID);
        
        console.log(`User [${userName}] (${socket.id}) đã vào phòng: ${roomID}`);

        // Thông báo cho những người cũ trong phòng biết có người mới vào để hiện tên
        socket.to(roomID).emit('user-joined', { 
            socketID: socket.id, 
            userName: userName 
        });

        // A. TRUNG CHUYỂN TÍN HIỆU VIDEO (WebRTC Signaling)
        socket.on('signal', (signalData) => {
            // Gửi tín hiệu kèm tên người gửi để bên nhận hiển thị đúng nhãn video
            socket.to(roomID).emit('signal', { 
                ...signalData, 
                fromName: userName 
            });
        });

        // B. ĐỒNG BỘ BẢNG TRẮNG (Nét vẽ)
        socket.on('draw-line', (drawData) => {
            socket.to(roomID).emit('draw-line', drawData);
        });

        // C. ĐỒNG BỘ BẢNG TRẮNG (Văn bản)
        socket.on('draw-text', (drawData) => {
            socket.to(roomID).emit('draw-text', drawData);
        });

        // D. XÓA BẢNG TRẮNG
        socket.on('clear-board', () => {
            socket.to(roomID).emit('clear-board');
        });

        // Xử lý ngắt kết nối
        socket.on('disconnect', () => {
            console.log(`User [${userName}] đã rời phòng ${roomID}`);
        });
    });
});

// 3. Khởi chạy Server
const PORT = 3000;
http.listen(PORT, () => {
    console.log('==============================================');
    console.log(`SERVER ĐANG CHẠY: http://localhost:${PORT}`);
    console.log('Tính năng: Video P2P, Whiteboard, Tên người dùng');
    console.log('==============================================');
});