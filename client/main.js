const socket = io();
let localStream, peerConnection, currentRoom;
let myName = ""; // Lưu tên của người dùng này
let drawing = false;
let mode = 'pen'; // Chế độ mặc định: 'pen' hoặc 'text'

// 1. TẠO MÀU CỐ ĐỊNH CHO MÁY NÀY (Để không bị nhảy màu khi nhiều người cùng vẽ)
const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16);

// --- QUẢN LÝ PHÒNG VÀ TÊN NGƯỜI DÙNG ---
// Nút Tạo cuộc họp mới
document.getElementById('btnCreate').onclick = () => {
    const name = document.getElementById('userNameInput').value;
    if (!name) return alert("Vui lòng nhập tên của bạn trước!");
    
    myName = name;
    const id = Math.random().toString(36).substring(2, 8); // Tạo mã ngẫu nhiên
    startSession(id);
};

// Nút Tham gia phòng có sẵn
document.getElementById('btnJoin').onclick = () => {
    const name = document.getElementById('userNameInput').value;
    const id = document.getElementById('roomInput').value;
    
    if (!name || !id) return alert("Vui lòng nhập đầy đủ Tên và Mã phòng!");
    
    myName = name;
    startSession(id);
};

// Nút Copy mã phòng
document.getElementById('btnCopy').onclick = () => {
    navigator.clipboard.writeText(currentRoom);
    alert("Đã copy mã phòng: " + currentRoom);
};

// Chuyển đổi công cụ Bảng trắng (Vẽ / Gõ chữ)
const btnPen = document.getElementById('btnPen');
const btnText = document.getElementById('btnText');

if (btnPen && btnText) {
    btnPen.onclick = () => {
        mode = 'pen';
        btnPen.classList.add('active');
        btnText.classList.remove('active');
    };

    btnText.onclick = () => {
        mode = 'text';
        btnText.classList.add('active');
        btnPen.classList.remove('active');
    };
}

async function startSession(id) {
    currentRoom = id;
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('meeting-screen').style.display = 'flex';
    document.getElementById('roomDisplay').innerText = id;
    document.getElementById('localNameTag').innerText = `Bạn: ${myName}`;

    // Gửi yêu cầu vào phòng kèm theo Tên người dùng lên Server 
    socket.emit('join-room', { roomID: id, userName: myName });
    
    initWhiteboard();
    await initWebRTC(); 
}

// --- LOGIC BẢNG TRẮNG ĐỒNG BỘ (TCP/WEB SOCKET) ---
function initWhiteboard() {
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    let lastX = 0;
    let lastY = 0;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Hàm vẽ nét
    const drawLine = (x, y, lX, lY, color) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.moveTo(lX, lY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.closePath();
    };

    // Hàm viết chữ
    const drawText = (text, x, y, color) => {
        ctx.fillStyle = color;
        ctx.font = "20px Arial";
        ctx.fillText(text, x, y);
    };

    canvas.onmousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (mode === 'pen') {
            drawing = true;
            [lastX, lastY] = [x, y];
        } else if (mode === 'text') {
            const text = prompt("Nhập nội dung văn bản:");
            if (text) {
                drawText(text, x, y, myColor);
                socket.emit('draw-text', { text, x, y, color: myColor });
            }
        }
    };

    canvas.onmousemove = (e) => {
        if (!drawing || mode !== 'pen') return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        drawLine(x, y, lastX, lastY, myColor);
        socket.emit('draw-line', { x, y, lastX, lastY, color: myColor });
        [lastX, lastY] = [x, y];
    };

    canvas.onmouseup = () => drawing = false;

    // Lắng nghe dữ liệu vẽ từ người khác
    socket.on('draw-line', (data) => drawLine(data.x, data.y, data.lastX, data.lastY, data.color));
    socket.on('draw-text', (data) => drawText(data.text, data.x, data.y, data.color));

    document.getElementById('btnClear').onclick = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear-board');
    };
    socket.on('clear-board', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
}

// --- LOGIC VIDEO CALL P2P (WEBRTC) ---
async function initWebRTC() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;

        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        peerConnection.ontrack = (e) => document.getElementById('remoteVideo').srcObject = e.streams[0];
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) socket.emit('signal', { candidate: e.candidate });
        };

        // Lắng nghe khi có người mới vào phòng để cập nhật tên 
        socket.on('user-joined', (data) => {
            document.getElementById('remoteNameTag').innerText = data.userName;
        });

        // Xử lý tín hiệu Signaling
        socket.on('signal', async (data) => {
            if (data.fromName) {
                document.getElementById('remoteNameTag').innerText = data.fromName;
            }

            if (data.offer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const ans = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(ans);
                socket.emit('signal', { answer: ans, fromName: myName });
            } else if (data.answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } else if (data.candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });

        // Gửi Offer kèm theo tên mình để máy kia hiển thị 
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { offer: offer, fromName: myName });

    } catch (e) {
        console.log("Camera lỗi hoặc không được cấp quyền, hệ thống vẫn chạy bảng trắng.");
    }
}