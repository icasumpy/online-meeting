const socket = io();

// --- BIẾN TOÀN CỤC ---
let localStream, peerConnection, currentRoom;
let myName = ""; 
let drawing = false;
let mode = 'pen'; 
let isMicOn = true;
let isCamOn = true;
const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
let participants = new Map(); // Map<socketID, {name, isLocal, joinTime}>

// --- DOM ELEMENTS ---
const contentWrapper = document.getElementById('content-wrapper');
const videoStage = document.getElementById('video-stage');
const boardPanel = document.getElementById('board-panel');
const btnToggleBoard = document.getElementById('btnToggleBoard');
const chatPanel = document.getElementById('chat-panel');
const btnToggleChat = document.getElementById('btnToggleChat');
const participantsPanel = document.getElementById('participants-panel');
const btnToggleParticipants = document.getElementById('btnToggleParticipants');
const notificationDot = document.getElementById('chatNotification');
const participantsList = document.getElementById('participantsList');

// --- QUẢN LÝ PHÒNG ---
document.getElementById('btnCreate').onclick = () => {
    const name = document.getElementById('userNameInput').value.trim();
    if (!name) return alert("Vui lòng nhập tên!");
    myName = name;
    const roomID = Math.random().toString(36).substring(2, 8).toUpperCase();
    requestJoin(roomID, 'create');
};

document.getElementById('btnJoin').onclick = () => {
    const name = document.getElementById('userNameInput').value.trim();
    const id = document.getElementById('roomInput').value.trim().toUpperCase();
    if (!name || !id) return alert("Vui lòng nhập đầy đủ thông tin!");
    if (id.length < 6) return alert("Mã phòng phải có ít nhất 6 ký tự!");
    myName = name;
    requestJoin(id, 'join');
};

document.getElementById('btnCopy').onclick = () => {
    if (!currentRoom) return;
    navigator.clipboard.writeText(currentRoom);
    alert("✅ Đã sao chép mã phòng!");
};

function requestJoin(id, actionType) {
    currentRoom = id;
    socket.emit('join-room', { roomID: id, userName: myName, action: actionType });
}

// --- KHI VÀO PHÒNG THÀNH CÔNG ---
socket.on('room-success', (data) => {
    const roomID = data.roomID;
    const existingParticipants = data.participants || [];
    
    console.log("%c✅ Vào phòng thành công!", "color: green; font-weight: bold");
    console.log("👥 Người đang trong phòng:", existingParticipants);
    
    // 1. Chuyển màn hình
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('meeting-screen').style.display = 'block'; 
    document.getElementById('roomDisplay').innerText = roomID;
    document.getElementById('localNameTag').innerText = `Bạn: ${myName}`;
    
    // 2. Reset danh sách
    participants.clear();
    
    // 3. Thêm chính mình vào danh sách
    addParticipantToList(socket.id, myName, true);
    
    // 4. Xử lý người đã có trong phòng
    if (existingParticipants.length > 0) {
        const firstParticipant = existingParticipants[0];
        document.getElementById('remoteNameTag').innerText = firstParticipant.userName;
        
        // Thêm tất cả người có sẵn vào danh sách
        existingParticipants.forEach(p => {
            addParticipantToList(p.socketID, p.userName, false);
        });
    } else {
        document.getElementById('remoteNameTag').innerText = 'Đang đợi người tham gia...';
    }
    
    // 5. CHẠY CAMERA NGAY LẬP TỨC
    initWebRTC(); 
    
    // 6. Khởi tạo Bảng trắng
    initWhiteboard();
    
    // 7. Thông báo chat
    addMessageToUI("Hệ thống", `Bạn đã tham gia phòng ${roomID}`, 'system');
});

socket.on('room-error', (msg) => alert(msg));

// --- XỬ LÝ NGƯỜI MỚI THAM GIA ---
socket.on('user-joined', async (data) => {
    console.log(`👤 ${data.userName} đã vào phòng (ID: ${data.socketID})`);
    
    // Cập nhật tên người khác
    document.getElementById('remoteNameTag').innerText = data.userName;
    
    // Thêm vào danh sách người tham gia
    addParticipantToList(data.socketID, data.userName, false);
    
    // Thông báo chat
    addMessageToUI("Hệ thống", `${data.userName} đã tham gia phòng`, 'system');
    
    // Tạo offer WebRTC
    if (peerConnection) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { 
                offer, 
                fromSocketID: socket.id, 
                fromName: myName 
            });
        } catch (error) {
            console.error("Lỗi khi tạo offer:", error);
        }
    }
});

// --- XỬ LÝ TÍN HIỆU WEBRTC ---
socket.on('signal', async (data) => {
    // Cập nhật tên từ signal data nếu có
    if (data.fromName && data.fromSocketID) {
        // Cập nhật hoặc thêm vào danh sách
        updateParticipantInList(data.fromSocketID, data.fromName);
    }
    
    if (data.offer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const ans = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(ans);
            socket.emit('signal', { 
                answer: ans, 
                fromSocketID: socket.id, 
                fromName: myName 
            });
        } catch (error) {
            console.error("Lỗi khi xử lý offer:", error);
        }
    } else if (data.answer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (error) {
            console.error("Lỗi khi xử lý answer:", error);
        }
    } else if (data.candidate) {
        try { 
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); 
        } catch(e) {
            console.warn("Lỗi khi thêm ICE candidate:", e);
        }
    }
});

// --- XỬ LÝ NGƯỜI RỜI PHÒNG ---
socket.on('user-left', (data) => {
    console.log(`👋 ${data.userName} đã rời phòng`);
    
    // Xóa khỏi danh sách
    removeParticipantFromList(data.socketID);
    
    // Nếu là người đang call thì reset remote video
    if (participants.size === 1) { // Chỉ còn mình
        document.getElementById('remoteVideo').srcObject = null;
        document.getElementById('remoteNameTag').innerText = 'Đang đợi người tham gia...';
    }
    
    // Thông báo chat
    addMessageToUI("Hệ thống", `${data.userName} đã rời phòng`, 'system');
});

// --- QUẢN LÝ DANH SÁCH NGƯỜI THAM GIA ---
function addParticipantToList(socketID, userName, isLocal) {
    participants.set(socketID, {
        name: userName,
        isLocal: isLocal,
        joinTime: new Date()
    });
    
    updateParticipantsUI();
}

function updateParticipantInList(socketID, userName) {
    if (participants.has(socketID)) {
        participants.get(socketID).name = userName;
    } else {
        participants.set(socketID, {
            name: userName,
            isLocal: false,
            joinTime: new Date()
        });
    }
    updateParticipantsUI();
}

function removeParticipantFromList(socketID) {
    participants.delete(socketID);
    updateParticipantsUI();
}

function updateParticipantsUI() {
    if (!participantsList) return;
    
    // Xóa nội dung cũ
    participantsList.innerHTML = '';
    
    // Thêm tiêu đề
    const header = document.createElement('div');
    header.className = 'participants-header';
    header.innerHTML = `<h4><i class="fa-solid fa-users"></i> Người tham gia (${participants.size})</h4>`;
    participantsList.appendChild(header);
    
    // Thêm từng người
    participants.forEach((participant, socketID) => {
        const div = document.createElement('div');
        div.className = 'participant-item';
        div.innerHTML = `
            <div class="participant-info">
                <span class="participant-avatar">${participant.name.charAt(0).toUpperCase()}</span>
                <div>
                    <strong>${participant.name}</strong>
                    <small>${participant.isLocal ? '(Bạn)' : ''} • ${formatTime(participant.joinTime)}</small>
                </div>
            </div>
            ${!participant.isLocal ? `<div class="participant-status online"></div>` : ''}
        `;
        participantsList.appendChild(div);
    });
}

function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    
    if (mins < 1) return 'Vừa tham gia';
    if (mins === 1) return '1 phút';
    return `${mins} phút`;
}

// --- XỬ LÝ GIAO DIỆN ---
function closeAllPanels() {
    boardPanel.classList.remove('active');
    chatPanel.classList.remove('active');
    participantsPanel.classList.remove('active');
    btnToggleBoard.classList.remove('active-state');
    btnToggleChat.classList.remove('active-state');
    btnToggleParticipants.classList.remove('active-state');
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

// Toggle Board
btnToggleBoard.onclick = () => {
    const isActive = boardPanel.classList.contains('active');
    closeAllPanels();
    if (!isActive) {
        boardPanel.classList.add('active');
        btnToggleBoard.classList.add('active-state');
        contentWrapper.classList.add('board-active');
        videoStage.classList.add('shrunk');

        setTimeout(() => {
            resizeCanvas();
            console.log("✏️ Bảng trắng đã sẵn sàng");
        }, 400);
    }
};
document.getElementById('btnCloseBoard').onclick = closeAllPanels;

// Toggle Participants
btnToggleParticipants.onclick = () => {
    const isActive = participantsPanel.classList.contains('active');
    closeAllPanels();
    if (!isActive) {
        participantsPanel.classList.add('active');
        btnToggleParticipants.classList.add('active-state');
    }
};
document.getElementById('btnCloseParticipants').onclick = closeAllPanels;

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
    
    btnClear.onclick = () => { 
        ctx.clearRect(0,0,canvas.width,canvas.height); 
        socket.emit('clear-board'); 
    };

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
    canvas.onmouseleave = () => drawing = false;

    // Nhận sự kiện từ người khác
    socket.on('draw-line', (d) => drawLine(d.x, d.y, d.lastX, d.lastY, d.color));
    socket.on('draw-text', (d) => drawText(d.text, d.x, d.y, d.color));
    socket.on('clear-board', () => ctx.clearRect(0,0,canvas.width,canvas.height));
}

function createTextInput(screenX, screenY, canvasX, canvasY) {
    const input = document.createElement('input');
    Object.assign(input.style, {
        position: 'fixed', 
        left: screenX + 'px', 
        top: screenY + 'px',
        padding: '5px 10px', 
        zIndex: 1000, 
        background: 'white', 
        border: '2px solid var(--primary)',
        borderRadius: '4px',
        outline: 'none',
        fontSize: '14px'
    });
    
    document.body.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const finish = () => {
        const val = input.value.trim();
        if (val) {
            ctx.fillStyle = myColor; 
            ctx.font = "20px Arial"; 
            ctx.fillText(val, canvasX, canvasY);
            socket.emit('draw-text', { text: val, x: canvasX, y: canvasY, color: myColor });
        }
        input.remove();
    };
    
    input.onkeydown = (e) => { 
        if(e.key === 'Enter') finish(); 
        if(e.key === 'Escape') {
            input.remove();
        }
    };
    
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
        socket.emit('chat-message', { text });
        chatInput.value = "";
    }
}

btnSend.onclick = sendMessage;
chatInput.onkeydown = (e) => { 
    if (e.key === 'Enter') sendMessage(); 
};

socket.on('chat-message', (data) => {
    addMessageToUI(data.userName, data.text, 'received');
    if (!chatPanel.classList.contains('active')) {
        notificationDot.style.display = 'block';
    }
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
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 } 
            }, 
            audio: true 
        });
        
        document.getElementById('localVideo').srcObject = localStream;
        console.log("✅ Đã lấy được Camera thành công!");

        // Tạo Peer Connection
        peerConnection = new RTCPeerConnection({ 
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ] 
        });

        // Thêm track từ local stream
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Xử lý remote track
        peerConnection.ontrack = (event) => {
            console.log("📹 Nhận được video từ người khác");
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
        };

        // Xử lý ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { candidate: event.candidate });
            }
        };

        // Xử lý trạng thái kết nối
        peerConnection.onconnectionstatechange = () => {
            console.log("🔗 Trạng thái kết nối:", peerConnection.connectionState);
        };

        setupMediaControls();
        
    } catch (error) {
        console.error("❌ Lỗi Camera:", error);
        if (error.name === 'NotAllowedError') {
            alert("⚠️ Vui lòng CHO PHÉP quyền truy cập Camera và Microphone!");
        } else if (error.name === 'NotFoundError') {
            alert("❌ Không tìm thấy thiết bị camera/microphone!");
        } else {
            alert("Lỗi Camera: " + error.message);
        }
    }
}

function setupMediaControls() {
    const btnMic = document.getElementById('btnMic');
    const btnCam = document.getElementById('btnCam');
    
    btnMic.onclick = () => {
        if (!localStream) return;
        
        isMicOn = !isMicOn;
        localStream.getAudioTracks()[0].enabled = isMicOn;
        btnMic.classList.toggle('red-state', !isMicOn);
        btnMic.innerHTML = isMicOn 
            ? '<i class="fa-solid fa-microphone"></i>' 
            : '<i class="fa-solid fa-microphone-slash"></i>';
    };
    
    btnCam.onclick = () => {
        if (!localStream) return;
        
        isCamOn = !isCamOn;
        localStream.getVideoTracks()[0].enabled = isCamOn;
        btnCam.classList.toggle('red-state', !isCamOn);
        btnCam.innerHTML = isCamOn 
            ? '<i class="fa-solid fa-video"></i>' 
            : '<i class="fa-solid fa-video-slash"></i>';
    };
}

// Xử lý khi đóng trang
window.addEventListener('beforeunload', () => {
    if (peerConnection) {
        peerConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
});