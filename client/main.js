const socket = io();
let localStream, peerConnection, currentRoom;
let myName = ""; 
let drawing = false;
let mode = 'pen'; 
let isMicOn = true;
let isCamOn = true;

// 1. TẠO MÀU CỐ ĐỊNH CHO MÁY NÀY
const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16);

// --- QUẢN LÝ PHÒNG VÀ GIAO DIỆN ---
document.getElementById('btnCreate').onclick = () => {
    const name = document.getElementById('userNameInput').value;
    if (!name) return alert("Vui lòng nhập tên của bạn trước!");
    myName = name;
    const id = Math.random().toString(36).substring(2, 8); 
    startSession(id);
};

document.getElementById('btnJoin').onclick = () => {
    const name = document.getElementById('userNameInput').value;
    const id = document.getElementById('roomInput').value;
    if (!name || !id) return alert("Vui lòng nhập đầy đủ Tên và Mã phòng!");
    myName = name;
    startSession(id);
};

document.getElementById('btnCopy').onclick = () => {
    navigator.clipboard.writeText(currentRoom);
    alert("Đã copy mã phòng: " + currentRoom);
};

// Chuyển đổi công cụ
const btnPen = document.getElementById('btnPen');
const btnText = document.getElementById('btnText');
if (btnPen && btnText) {
    btnPen.onclick = () => { mode = 'pen'; btnPen.classList.add('active'); btnText.classList.remove('active'); };
    btnText.onclick = () => { mode = 'text'; btnText.classList.add('active'); btnPen.classList.remove('active'); };
}

async function startSession(id) {
    currentRoom = id;
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('meeting-screen').style.display = 'flex';
    document.getElementById('roomDisplay').innerText = id;
    document.getElementById('localNameTag').innerText = `Bạn: ${myName}`;

    socket.emit('join-room', { roomID: id, userName: myName });
    
    initWhiteboard();
    await initWebRTC(); 
}

// --- LOGIC BẢNG TRẮNG (TCP/WEB SOCKET) ---
function initWhiteboard() {
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    let lastX = 0, lastY = 0;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

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
            // Xóa ô nhập cũ nếu đang gõ dở ở chỗ khác
            const oldInput = document.querySelector('.temp-text-input');
            if (oldInput) oldInput.blur();

            // Tạo ô nhập liệu "Google Drive"
            const input = document.createElement('input');
            input.className = 'temp-text-input';
            
            // Đặt vị trí ô nhập đúng điểm click
            input.style.left = e.clientX + 'px';
            input.style.top = (e.clientY - 10) + 'px'; 
            
            document.body.appendChild(input);
            
            // Focus ngay lập tức để gõ luôn
            setTimeout(() => input.focus(), 0);

            const saveAndExit = () => {
                const val = input.value.trim();
                if (val) {
                    drawText(val, x, y, myColor);
                    socket.emit('draw-text', { text: val, x, y, color: myColor });
                }
                if (input.parentNode) input.remove();
            };

            // Ngăn chặn việc click vào ô input làm kích hoạt vẽ trên canvas
            input.onmousedown = (ev) => ev.stopPropagation();

            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') saveAndExit();
                if (ev.key === 'Escape') input.remove();
            };
            input.onblur = saveAndExit;
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

        peerConnection.ontrack = (e) => {
            document.getElementById('remoteVideo').srcObject = e.streams[0];
        };

        peerConnection.onicecandidate = (e) => {
            if (e.candidate) socket.emit('signal', { candidate: e.candidate });
        };

        socket.on('user-joined', async (data) => {
            document.getElementById('remoteNameTag').innerText = data.userName;
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { offer: offer, fromName: myName });
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
                if (peerConnection.remoteDescription) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch(e) { console.warn("Candidate lỗi:", e); }
                }
            }
        });

        // Bổ sung điều khiển Mic/Cam
        setupMediaControls();

    } catch (e) {
        console.error("Lỗi Camera/Mic:", e);
        alert("Không thể mở Camera. Bạn vẫn có thể dùng bảng trắng.");
    }
}

function setupMediaControls() {
    document.getElementById('btnMic').onclick = () => {
        isMicOn = !isMicOn;
        localStream.getAudioTracks()[0].enabled = isMicOn;
        document.getElementById('btnMic').classList.toggle('red', !isMicOn);
        document.getElementById('btnMic').innerHTML = isMicOn ? 
            '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
    };

    document.getElementById('btnCam').onclick = () => {
        isCamOn = !isCamOn;
        localStream.getVideoTracks()[0].enabled = isCamOn;
        document.getElementById('btnCam').classList.toggle('red', !isCamOn);
        document.getElementById('btnCam').innerHTML = isCamOn ? 
            '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
    };
}