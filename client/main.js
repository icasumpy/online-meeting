const socket = io();

// --- BIẾN TOÀN CỤC ---
let localStream, peerConnection, currentRoom;
let myName = ""; 
let drawing = false;
let mode = 'pen'; 
let isMicOn = true;
let isCamOn = true;
const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16);

// --- DOM ELEMENTS ---
const contentWrapper = document.getElementById('content-wrapper');
const videoStage = document.getElementById('video-stage');
const boardPanel = document.getElementById('board-panel');
const btnToggleBoard = document.getElementById('btnToggleBoard');
const chatPanel = document.getElementById('chat-panel');
const btnToggleChat = document.getElementById('btnToggleChat');
const notificationDot = document.getElementById('chatNotification');

// --- QUẢN LÝ PHÒNG ---
document.getElementById('btnCreate').onclick = () => {
    const name = document.getElementById('userNameInput').value;
    if (!name) return alert("Vui lòng nhập tên!");
    myName = name;
    requestJoin(Math.random().toString(36).substring(2, 8), 'create');
};

document.getElementById('btnJoin').onclick = () => {
    const name = document.getElementById('userNameInput').value;
    const id = document.getElementById('roomInput').value.trim();
    if (!name || !id) return alert("Thiếu thông tin!");
    myName = name;
    requestJoin(id, 'join');
};

document.getElementById('btnCopy').onclick = () => {
    navigator.clipboard.writeText(currentRoom);
    alert("Đã sao chép mã phòng!");
};

function requestJoin(id, actionType) {
    currentRoom = id;
    socket.emit('join-room', { roomID: id, userName: myName, action: actionType });
}

// --- KHI VÀO PHÒNG THÀNH CÔNG ---
socket.on('room-success', (roomID) => {
    console.log("%c✅ Vào phòng thành công!", "color: green; font-weight: bold");
    
    // 1. Chuyển màn hình
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('meeting-screen').style.display = 'block'; 
    document.getElementById('roomDisplay').innerText = roomID;
    document.getElementById('localNameTag').innerText = `Bạn: ${myName}`;

    // 2. CHẠY CAMERA NGAY LẬP TỨC
    // Gọi hàm này đầu tiên để đảm bảo lấy được hình ảnh
    initWebRTC(); 

    // 3. Khởi tạo Bảng trắng (nhưng chưa resize ngay)
    initWhiteboard();
});

socket.on('room-error', (msg) => alert(msg));

// --- XỬ LÝ GIAO DIỆN ---
function closeAllPanels() {
    boardPanel.classList.remove('active');
    chatPanel.classList.remove('active');
    btnToggleBoard.classList.remove('active-state');
    btnToggleChat.classList.remove('active-state');
    contentWrapper.classList.remove('board-active');
    videoStage.classList.remove('shrunk');
}

// Toggle Chat
btnToggleChat.onclick = () => {
    const isActive = chatPanel.classList.contains('active');
    closeAllPanels();
    if (!isActive) {
        chatPanel.classList.add('active');
        btnToggleChat.classList.add('active-state');
        notificationDot.style.display = 'none';
        setTimeout(() => document.getElementById('chatInput').focus(), 300);
    }
};
document.getElementById('btnCloseChat').onclick = closeAllPanels;

// Toggle Board (FIX LỖI BẢNG KHÔNG VẼ ĐƯỢC)
btnToggleBoard.onclick = () => {
    const isActive = boardPanel.classList.contains('active');
    closeAllPanels();
    if (!isActive) {
        boardPanel.classList.add('active');
        btnToggleBoard.classList.add('active-state');
        contentWrapper.classList.add('board-active');
        videoStage.classList.add('shrunk');

        // QUAN TRỌNG: Đợi hiệu ứng trượt xong mới tính kích thước bảng
        setTimeout(() => {
            resizeCanvas();
            console.log("✏️ Bảng trắng đã sẵn sàng");
        }, 400); 
    }
};
document.getElementById('btnCloseBoard').onclick = closeAllPanels;

// --- LOGIC BẢNG TRẮNG ---
let canvas, ctx;

function resizeCanvas() {
    if (!canvas) return;
    const container = document.querySelector('.canvas-container');
    if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
    }
}
window.addEventListener('resize', resizeCanvas);

function initWhiteboard() {
    canvas = document.getElementById('whiteboard');
    ctx = canvas.getContext('2d');
    
    let lastX = 0, lastY = 0;
    const btnPen = document.getElementById('btnPen');
    const btnText = document.getElementById('btnText');
    const btnClear = document.getElementById('btnClear');

    // Mặc định chọn bút
    if(btnPen) btnPen.classList.add('active');

    btnPen.onclick = () => { mode = 'pen'; btnPen.classList.add('active'); btnText.classList.remove('active'); };
    btnText.onclick = () => { mode = 'text'; btnText.classList.add('active'); btnPen.classList.remove('active'); };
    btnClear.onclick = () => { ctx.clearRect(0,0,canvas.width,canvas.height); socket.emit('clear-board'); };

    const drawLine = (x, y, lX, lY, color) => {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.moveTo(lX, lY); ctx.lineTo(x, y); ctx.stroke(); ctx.closePath();
    };
    const drawText = (text, x, y, color) => {
        ctx.fillStyle = color; ctx.font = "20px Arial"; ctx.fillText(text, x, y);
    };

    canvas.onmousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (mode === 'pen') {
            drawing = true;
            [lastX, lastY] = [x, y];
        } else if (mode === 'text') {
            createTextInput(e.clientX, e.clientY, x, y);
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

    socket.on('draw-line', (d) => drawLine(d.x, d.y, d.lastX, d.lastY, d.color));
    socket.on('draw-text', (d) => drawText(d.text, d.x, d.y, d.color));
    socket.on('clear-board', () => ctx.clearRect(0,0,canvas.width,canvas.height));
}

function createTextInput(screenX, screenY, canvasX, canvasY) {
    const input = document.createElement('input');
    Object.assign(input.style, {
        position: 'fixed', left: screenX + 'px', top: screenY + 'px',
        padding: '5px', zIndex: 1000, background: 'white', border: '1px solid #1a73e8'
    });
    document.body.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const finish = () => {
        const val = input.value.trim();
        if (val) {
            ctx.fillStyle = myColor; ctx.font = "20px Arial"; ctx.fillText(val, canvasX, canvasY);
            socket.emit('draw-text', { text: val, x: canvasX, y: canvasY, color: myColor });
        }
        input.remove();
    };
    input.onkeydown = (e) => { if(e.key === 'Enter') finish(); };
    input.onblur = finish;
}

// --- CHAT ---
const btnSend = document.getElementById('btnSend');
const chatInput = document.getElementById('chatInput');
const messagesList = document.getElementById('chat-messages');

function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        addMessageToUI("Bạn", text, 'sent');
        socket.emit('chat-message', { roomID: currentRoom, userName: myName, text });
        chatInput.value = "";
    }
}
btnSend.onclick = sendMessage;
chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };

socket.on('chat-message', (data) => {
    addMessageToUI(data.userName, data.text, 'received');
    if (!chatPanel.classList.contains('active')) notificationDot.style.display = 'block';
});

function addMessageToUI(sender, text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    if (type === 'received') {
        const span = document.createElement('span');
        span.className = 'sender-name';
        span.innerText = sender;
        div.appendChild(span);
    }
    div.appendChild(document.createTextNode(text));
    messagesList.appendChild(div);
    messagesList.scrollTop = messagesList.scrollHeight;
}

// --- CAMERA (WEBRTC) ---
async function initWebRTC() {
    console.log("🎥 Đang khởi động Camera...");
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
        console.log("Đã lấy được Camera thành công!");

        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        peerConnection.ontrack = (e) => {
            console.log("Nhận được video từ người khác");
            document.getElementById('remoteVideo').srcObject = e.streams[0];
        };

        peerConnection.onicecandidate = (e) => {
            if (e.candidate) socket.emit('signal', { candidate: e.candidate });
        };

        socket.on('user-joined', async (data) => {
            console.log(` ${data.userName} đã vào phòng`);
            document.getElementById('remoteNameTag').innerText = data.userName;
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { offer, fromName: myName });
        });

        socket.on('signal', async (data) => {
            if (data.fromName) document.getElementById('remoteNameTag').innerText = data.fromName;
            if (data.offer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const ans = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(ans);
                socket.emit('signal', { answer: ans, fromName: myName });
            } else if (data.answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } else if (data.candidate) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e){}
            }
        });
        
        setupMediaControls();
    } catch (e) {
        console.error("❌ Lỗi Camera:", e);
        if (e.name === 'NotAllowedError') alert("⚠️ Vui lòng CHO PHÉP quyền truy cập Camera trên trình duyệt!");
        else alert("Lỗi Camera: " + e.message);
    }
}

function setupMediaControls() {
    const btnMic = document.getElementById('btnMic');
    const btnCam = document.getElementById('btnCam');
    
    btnMic.onclick = () => {
        isMicOn = !isMicOn;
        localStream.getAudioTracks()[0].enabled = isMicOn;
        btnMic.classList.toggle('red-state', !isMicOn);
        btnMic.innerHTML = isMicOn ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
    };
    btnCam.onclick = () => {
        isCamOn = !isCamOn;
        localStream.getVideoTracks()[0].enabled = isCamOn;
        btnCam.classList.toggle('red-state', !isCamOn);
        btnCam.innerHTML = isCamOn ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
    };
}