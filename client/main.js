const socket = io();

// --- BIẾN TOÀN CỤC ---
let localStream, peerConnection, currentRoom;
let screenStream = null; // Stream cho screen sharing
let myName = ""; 
let drawing = false;
let mode = 'pen'; 
let isMicOn = true;
let isCamOn = true;
let isScreenSharing = false;
const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
let participants = new Map(); // Map<socketID, {name, isLocal, joinTime}>
let canvas, ctx;
let currentRecipient = null; // Người nhận tin nhắn riêng
let fileInput = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

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
const btnSend = document.getElementById('btnSend');
const chatInput = document.getElementById('chatInput');
const messagesList = document.getElementById('chat-messages');
const btnScreenShare = document.getElementById('btnScreenShare');
const screenPreview = document.getElementById('screenPreview');
const screenVideo = document.getElementById('screenVideo');

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

// Sao chép mã phòng với feedback tốt hơn
document.getElementById('btnCopy').onclick = async () => {
    if (!currentRoom) return;
    
    try {
        await navigator.clipboard.writeText(currentRoom);
        // Thay đổi icon tạm thời để báo hiệu thành công
        const icon = document.querySelector('#btnCopy i');
        const originalClass = icon.className;
        icon.className = 'fa-solid fa-check';
        
        setTimeout(() => {
            icon.className = originalClass;
        }, 1000);
    } catch (err) {
        console.error('Lỗi sao chép:', err);
        
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = currentRoom;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        // Thay đổi icon tạm thời
        const icon = document.querySelector('#btnCopy i');
        const originalClass = icon.className;
        icon.className = 'fa-solid fa-check';
        
        setTimeout(() => {
            icon.className = originalClass;
        }, 1000);
    }
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
    connectionAttempts = 0;
    
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
        
        // Tạo kết nối WebRTC ngay lập tức
        setTimeout(() => {
            createPeerConnection();
            if (peerConnection) {
                initWebRTC();
            }
        }, 1000);
    } else {
        document.getElementById('remoteNameTag').innerText = 'Đang đợi người tham gia...';
        // Chỉ khởi tạo camera khi chưa có ai trong phòng
        initWebRTC();
    }
    
    // 5. Khởi tạo Bảng trắng
    initWhiteboard();
    
    // 6. Thêm nút Export bảng
    addExportButton();
    
    // 7. Thêm input file cho chat
    addFileUploadButton();
    
    // 8. Thông báo chat
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
    
    // Tạo kết nối WebRTC với người mới
    createPeerConnection();
    
    // Tạo offer WebRTC
    if (peerConnection && (localStream || screenStream)) {
        try {
            // Chờ một chút để đảm bảo peer connection sẵn sàng
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('signal', { 
                offer, 
                fromSocketID: socket.id, 
                fromName: myName,
                roomID: currentRoom,
                isScreenSharing: isScreenSharing
            });
            
            console.log("📡 Đã gửi WebRTC offer");
        } catch (error) {
            console.error("Lỗi khi tạo offer:", error);
            // Thử lại nếu thất bại
            if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
                connectionAttempts++;
                setTimeout(() => {
                    socket.emit('signal', { 
                        offer, 
                        fromSocketID: socket.id, 
                        fromName: myName,
                        roomID: currentRoom,
                        isScreenSharing: isScreenSharing
                    });
                }, 1000 * connectionAttempts);
            }
        }
    }
});

// --- TẠO PEER CONNECTION ---
function createPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
    }
    
    // Cấu hình ICE servers cho mạng LAN/Wifi
    const configuration = {
        iceServers: [
            // STUN servers (miễn phí) - quan trọng cho NAT traversal
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            
            // STUN server khác
            { urls: 'stun:stun.stunprotocol.org:3478' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    };
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // Xử lý remote track
    peerConnection.ontrack = (event) => {
        console.log("📹 Nhận được video từ người khác");
        
        // Kiểm tra xem track có phải là screen sharing không
        const isScreenTrack = event.streams[0]?.id.includes('screen') || 
                             event.track.kind === 'video' && event.track.label.includes('screen');
        
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.log("Lỗi play remote video:", e));
            
            // Cập nhật label nếu là screen sharing
            if (isScreenTrack) {
                document.getElementById('remoteNameTag').innerText = 'Đang chia sẻ màn hình...';
            }
        }
    };
    
    // Xử lý ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { 
                candidate: event.candidate,
                fromSocketID: socket.id,
                fromName: myName,
                roomID: currentRoom,
                isScreenSharing: isScreenSharing
            });
        }
    };
    
    // Xử lý trạng thái kết nối
    peerConnection.oniceconnectionstatechange = () => {
        console.log("❄️ ICE Connection State:", peerConnection.iceConnectionState);
        
        switch(peerConnection.iceConnectionState) {
            case 'connected':
            case 'completed':
                console.log("✅ WebRTC kết nối thành công!");
                addMessageToUI("Hệ thống", "Kết nối video đã sẵn sàng", 'system');
                break;
            case 'disconnected':
                console.log("⚠️ Kết nối bị gián đoạn, đang thử kết nối lại...");
                break;
            case 'failed':
                console.log("❌ Kết nối thất bại");
                addMessageToUI("Hệ thống", "Không thể kết nối video. Kiểm tra mạng và thử lại", 'system');
                break;
            case 'closed':
                console.log("🔒 Kết nối đã đóng");
                break;
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log("🔗 Connection State:", peerConnection.connectionState);
    };
    
    peerConnection.onsignalingstatechange = () => {
        console.log("📶 Signaling State:", peerConnection.signalingState);
    };
    
    // Thêm local tracks nếu có
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Thêm screen track nếu đang share screen
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, screenStream);
        });
    }
}

// --- XỬ LÝ TÍN HIỆU WEBRTC ---
socket.on('signal', async (data) => {
    // Chỉ xử lý tín hiệu từ cùng phòng
    if (data.roomID !== currentRoom) return;
    
    // Cập nhật tên từ signal data nếu có
    if (data.fromName && data.fromSocketID) {
        updateParticipantInList(data.fromSocketID, data.fromName);
    }
    
    try {
        if (data.offer) {
            console.log("📥 Nhận được WebRTC offer từ", data.fromName);
            
            // Tạo peer connection nếu chưa có
            if (!peerConnection) {
                createPeerConnection();
            }
            
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('signal', { 
                answer: answer, 
                fromSocketID: socket.id, 
                fromName: myName,
                roomID: currentRoom,
                isScreenSharing: isScreenSharing
            });
            
        } else if (data.answer) {
            console.log("📥 Nhận được WebRTC answer từ", data.fromName);
            
            if (peerConnection && peerConnection.remoteDescription === null) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
            
        } else if (data.candidate) {
            if (peerConnection && peerConnection.remoteDescription) {
                try { 
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); 
                } catch(e) {
                    console.warn("Lỗi khi thêm ICE candidate:", e);
                }
            }
        }
    } catch (error) {
        console.error("Lỗi xử lý tín hiệu WebRTC:", error);
    }
});

// --- XỬ LÝ NGƯỜI RỜI PHÒNG ---
socket.on('user-left', (data) => {
    console.log(`👋 ${data.userName} đã rời phòng`);
    
    // Xóa khỏi danh sách
    removeParticipantFromList(data.socketID);
    
    // Nếu đang gửi tin nhắn riêng cho người này
    if (currentRecipient === data.socketID) {
        currentRecipient = null;
        updateChatUI();
    }
    
    // Nếu là người đang call thì reset remote video
    if (participants.size === 1) { // Chỉ còn mình
        document.getElementById('remoteVideo').srcObject = null;
        document.getElementById('remoteNameTag').innerText = 'Đang đợi người tham gia...';
        
        // Đóng peer connection
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
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
    
    // Thêm từng người với nút nhắn riêng
    participants.forEach((participant, socketID) => {
        const div = document.createElement('div');
        div.className = 'participant-item';
        
        const messageBtn = participant.isLocal ? '' : 
            `<button class="btn-private-message" data-socketid="${socketID}" title="Nhắn riêng">
                <i class="fa-solid fa-message"></i>
            </button>`;
        
        div.innerHTML = `
            <div class="participant-info">
                <span class="participant-avatar">${participant.name.charAt(0).toUpperCase()}</span>
                <div>
                    <strong>${participant.name}</strong>
                    <small>${participant.isLocal ? '(Bạn)' : ''} • ${formatTime(participant.joinTime)}</small>
                </div>
            </div>
            <div class="participant-actions">
                ${!participant.isLocal ? `<div class="participant-status online"></div>` : ''}
                ${messageBtn}
            </div>
        `;
        
        participantsList.appendChild(div);
        
        // Thêm sự kiện cho nút nhắn riêng
        if (!participant.isLocal) {
            const btn = div.querySelector('.btn-private-message');
            if (btn) {
                btn.onclick = () => startPrivateChat(socketID, participant.name);
            }
        }
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
        updateChatUI();
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

// --- LOGIC BẢNG TRẮNG & EXPORT ---
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

function addExportButton() {
    const boardTools = document.querySelector('.board-tools');
    if (!boardTools) return;
    
    const exportBtn = document.createElement('button');
    exportBtn.className = 'tool-btn export-btn';
    exportBtn.title = 'Xuất bảng trắng';
    exportBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
    exportBtn.onclick = exportWhiteboard;
    
    boardTools.appendChild(exportBtn);
}

function exportWhiteboard() {
    if (!canvas) return;
    
    // Tạo link download
    const link = document.createElement('a');
    link.download = `bảng-trắng-${currentRoom}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Thông báo
    addMessageToUI("Hệ thống", "Đã xuất bảng trắng thành ảnh PNG", 'system');
}

// --- CHAT NÂNG CAO ---
function addFileUploadButton() {
    const chatInputArea = document.querySelector('.chat-input-area');
    if (!chatInputArea) return;
    
    // Tạo input file ẩn
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'fileInput';
    fileInput.style.display = 'none';
    fileInput.accept = 'image/*,.pdf,.doc,.docx,.txt,.zip,.rar';
    fileInput.multiple = false;
    
    // Nút upload file
    const uploadBtn = document.createElement('button');
    uploadBtn.id = 'btnUploadFile';
    uploadBtn.title = 'Gửi file/hình ảnh';
    uploadBtn.innerHTML = '<i class="fa-solid fa-paperclip"></i>';
    uploadBtn.type = 'button';
    
    uploadBtn.onclick = () => fileInput.click();
    
    // Thêm vào chat input area
    chatInputArea.insertBefore(uploadBtn, chatInputArea.querySelector('button'));
    chatInputArea.insertBefore(fileInput, uploadBtn);
    
    // Xử lý khi chọn file
    fileInput.onchange = handleFileUpload;
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert('File quá lớn! Tối đa 10MB');
        fileInput.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Data = e.target.result;
        
        // Gửi file qua socket
        socket.emit('chat-file', {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            fileData: base64Data // Gửi cả data URL đầy đủ
        });
        
        // Hiển thị ở UI với fileData
        addFileMessageToUI("Bạn", file.name, file.type, file.size, true, base64Data);
        
        // Reset input
        fileInput.value = '';
    };
    
    reader.readAsDataURL(file);
}

function updateChatUI() {
    const chatHeader = document.querySelector('.chat-panel .panel-header h3');
    if (!chatHeader) return;
    
    if (currentRecipient) {
        const recipient = participants.get(currentRecipient);
        chatHeader.innerHTML = `<i class="fa-solid fa-message"></i> Tin nhắn riêng với ${recipient?.name || '...'}`;
        chatHeader.style.color = '#8ab4f8';
        
        // Thêm nút quay lại chat nhóm
        if (!document.getElementById('btnBackToGroup')) {
            const backBtn = document.createElement('button');
            backBtn.id = 'btnBackToGroup';
            backBtn.className = 'back-btn';
            backBtn.title = 'Quay lại chat nhóm';
            backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
            backBtn.onclick = () => {
                currentRecipient = null;
                updateChatUI();
            };
            
            const panelHeader = document.querySelector('.chat-panel .panel-header');
            panelHeader.insertBefore(backBtn, panelHeader.querySelector('.close-btn'));
        }
    } else {
        chatHeader.innerHTML = `<i class="fa-solid fa-message"></i> Tin nhắn`;
        chatHeader.style.color = '';
        
        // Xóa nút back nếu có
        const backBtn = document.getElementById('btnBackToGroup');
        if (backBtn) backBtn.remove();
    }
}

function startPrivateChat(socketID, userName) {
    currentRecipient = socketID;
    updateChatUI();
    
    // Mở chat panel nếu chưa mở
    if (!chatPanel.classList.contains('active')) {
        closeAllPanels();
        chatPanel.classList.add('active');
        btnToggleChat.classList.add('active-state');
        notificationDot.style.display = 'none';
    }
    
    // Thông báo
    addMessageToUI("Hệ thống", `Bắt đầu chat riêng với ${userName}`, 'system');
}

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    
    if (currentRecipient) {
        // Gửi tin nhắn riêng
        socket.emit('private-message', { 
            toSocketID: currentRecipient, 
            text 
        });
        addMessageToUI("Bạn (riêng)", text, 'private-sent');
    } else {
        // Gửi tin nhắn nhóm
        socket.emit('chat-message', { text });
        addMessageToUI("Bạn", text, 'sent');
    }
    
    chatInput.value = "";
}

btnSend.onclick = sendMessage;
chatInput.onkeydown = (e) => { 
    if (e.key === 'Enter') sendMessage(); 
};

// Nhận tin nhắn từ người khác
socket.on('chat-message', (data) => {
    if (data.type === 'file') {
        addFileMessageToUI(
            data.userName, 
            data.fileName, 
            data.fileType, 
            data.fileSize, 
            false, 
            data.fileData // Thêm fileData vào
        );
    } else {
        addMessageToUI(data.userName, data.text, 'received');
    }
    
    if (!chatPanel.classList.contains('active')) {
        notificationDot.style.display = 'block';
    }
});

// Nhận tin nhắn riêng
socket.on('private-message', (data) => {
    addMessageToUI(`${data.fromName} (riêng)`, data.text, 'private-received');
    
    if (!chatPanel.classList.contains('active')) {
        notificationDot.style.display = 'block';
    }
});

socket.on('private-message-sent', () => {
    console.log("✅ Tin nhắn riêng đã gửi");
});

function addMessageToUI(sender, text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (type === 'received' || type === 'private-received') {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'sender-name';
        senderSpan.innerText = sender;
        div.appendChild(senderSpan);
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.innerText = time;
        timeSpan.style.fontSize = '10px';
        timeSpan.style.marginLeft = '8px';
        timeSpan.style.color = '#888';
        senderSpan.appendChild(timeSpan);
    }
    
    const textSpan = document.createElement('span');
    textSpan.innerText = text;
    div.appendChild(textSpan);
    
    if (type === 'sent' || type === 'private-sent') {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.innerText = time;
        timeSpan.style.display = 'block';
        timeSpan.style.fontSize = '10px';
        timeSpan.style.color = '#888';
        timeSpan.style.textAlign = 'right';
        timeSpan.style.marginTop = '2px';
        div.appendChild(timeSpan);
    }
    
    messagesList.appendChild(div);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function addFileMessageToUI(sender, fileName, fileType, fileSize, isSent, fileData = null) {
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (!isSent) {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'sender-name';
        senderSpan.innerText = sender;
        div.appendChild(senderSpan);
    }
    
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-message';
    
    // Biểu tượng file theo loại
    let fileIcon = 'fa-file';
    if (fileType.startsWith('image/')) fileIcon = 'fa-image';
    else if (fileType.includes('pdf')) fileIcon = 'fa-file-pdf';
    else if (fileType.includes('word')) fileIcon = 'fa-file-word';
    else if (fileType.includes('zip') || fileType.includes('rar')) fileIcon = 'fa-file-archive';
    else if (fileType.includes('text')) fileIcon = 'fa-file-text';
    
    fileDiv.innerHTML = `
        <div class="file-icon">
            <i class="fa-solid ${fileIcon}"></i>
        </div>
        <div class="file-info">
            <div class="file-name">${fileName}</div>
            <div class="file-size">${formatFileSize(fileSize)}</div>
        </div>
        <div class="file-download">
            <i class="fa-solid fa-download"></i>
        </div>
    `;
    
    // Xử lý download file
    fileDiv.onclick = (e) => {
        e.stopPropagation();
        
        if (!fileData) {
            alert("Không có dữ liệu file để tải xuống");
            return;
        }
        
        try {
            // Sử dụng data URL trực tiếp
            const link = document.createElement('a');
            link.href = fileData;
            link.download = fileName;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            
            // Dọn dẹp
            setTimeout(() => {
                document.body.removeChild(link);
            }, 100);
            
            console.log(`✅ Đã tải file: ${fileName}`);
            
        } catch (error) {
            console.error("Lỗi khi tải file:", error);
            alert("Lỗi khi tải file. Vui lòng thử lại!");
        }
    };
    
    div.appendChild(fileDiv);
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.innerText = time;
    timeSpan.style.fontSize = '10px';
    timeSpan.style.color = '#888';
    timeSpan.style.marginTop = '4px';
    timeSpan.style.display = 'block';
    timeSpan.style.textAlign = isSent ? 'right' : 'left';
    div.appendChild(timeSpan);
    
    messagesList.appendChild(div);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- SCREEN SHARING ---
btnScreenShare.onclick = async () => {
    try {
        if (!isScreenSharing) {
            // Bắt đầu chia sẻ màn hình
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: "always",
                    displaySurface: "monitor"
                },
                audio: false
            });
            
            // Hiển thị preview
            screenVideo.srcObject = screenStream;
            screenPreview.style.display = 'block';
            
            // Cập nhật UI
            isScreenSharing = true;
            btnScreenShare.classList.add('screen-share-active');
            videoStage.classList.add('screen-shared');
            
            // Thêm screen track vào peer connection
            if (peerConnection) {
                screenStream.getTracks().forEach(track => {
                    // Thay thế video track cũ bằng screen track
                    const senders = peerConnection.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    
                    if (videoSender) {
                        videoSender.replaceTrack(track);
                    } else {
                        peerConnection.addTrack(track, screenStream);
                    }
                });
            }
            
            // Thông báo
            addMessageToUI("Hệ thống", "Đã bắt đầu chia sẻ màn hình", 'system');
            
            // Xử lý khi người dùng dừng chia sẻ màn hình
            screenStream.getVideoTracks()[0].onended = () => {
                stopScreenSharing();
            };
            
        } else {
            // Dừng chia sẻ màn hình
            stopScreenSharing();
        }
        
    } catch (error) {
        console.error("Lỗi khi chia sẻ màn hình:", error);
        if (error.name === 'NotAllowedError') {
            alert("Bạn đã từ chối chia sẻ màn hình.");
        }
    }
};

function stopScreenSharing() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Ẩn preview
    screenPreview.style.display = 'none';
    
    // Cập nhật UI
    isScreenSharing = false;
    btnScreenShare.classList.remove('screen-share-active');
    videoStage.classList.remove('screen-shared');
    
    // Khôi phục camera track
    if (peerConnection && localStream) {
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        
        if (videoSender && localStream.getVideoTracks()[0]) {
            videoSender.replaceTrack(localStream.getVideoTracks()[0]);
        }
    }
    
    // Thông báo
    addMessageToUI("Hệ thống", "Đã dừng chia sẻ màn hình", 'system');
}

// --- CAMERA (WEBRTC) ---
async function initWebRTC() {
    console.log("🎥 Đang khởi động Camera...");
    try {
        // Kiểm tra quyền truy cập trước
        const permissions = await navigator.permissions.query({ name: 'camera' });
        console.log("Quyền camera:", permissions.state);
        
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 30, max: 60 },
                facingMode: 'user'
            }, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100,
                channelCount: 2
            }
        });
        
        document.getElementById('localVideo').srcObject = localStream;
        console.log("✅ Đã lấy được Camera thành công!");
        
        // Tự động play video
        document.getElementById('localVideo').play().catch(e => console.log("Lỗi play local video:", e));

        // Tạo peer connection nếu chưa có
        if (!peerConnection) {
            createPeerConnection();
        }
        
        // Thêm local tracks vào peer connection
        if (peerConnection) {
            localStream.getTracks().forEach(track => {
                if (peerConnection.getSenders().find(s => s.track === track)) return;
                peerConnection.addTrack(track, localStream);
            });
        }
        
        setupMediaControls();
        
        // Kiểm tra ICE gathering
        setTimeout(() => {
            if (peerConnection) {
                console.log("ICE Gathering State:", peerConnection.iceGatheringState);
            }
        }, 2000);
        
    } catch (error) {
        console.error("❌ Lỗi Camera:", error);
        if (error.name === 'NotAllowedError') {
            alert("⚠️ Vui lòng CHO PHÉP quyền truy cập Camera và Microphone!\n\nTrình duyệt đã chặn quyền truy cập. Vui lòng:\n1. Nhấp vào biểu tượng ổ khóa trên thanh địa chỉ\n2. Chọn 'Cho phép' Camera và Micro\n3. Tải lại trang");
        } else if (error.name === 'NotFoundError') {
            alert("❌ Không tìm thấy thiết bị camera/microphone!\n\nVui lòng kiểm tra:\n1. Camera/micro có được kết nối không\n2. Không có ứng dụng nào khác đang sử dụng camera\n3. Thử với trình duyệt khác");
        } else if (error.name === 'NotReadableError') {
            alert("❌ Không thể đọc từ thiết bị camera/micro!\n\nCó thể do:\n1. Driver camera bị lỗi\n2. Thiết bị đang bị chiếm dụng\n3. Thử khởi động lại trình duyệt");
        } else {
            alert("Lỗi Camera: " + error.message + "\n\nVui lòng thử với trình duyệt Chrome hoặc Edge mới nhất.");
        }
    }
}

function setupMediaControls() {
    const btnMic = document.getElementById('btnMic');
    const btnCam = document.getElementById('btnCam');
    
    btnMic.onclick = () => {
        if (!localStream) return;
        
        isMicOn = !isMicOn;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = isMicOn;
        }
        btnMic.classList.toggle('red-state', !isMicOn);
        btnMic.innerHTML = isMicOn 
            ? '<i class="fa-solid fa-microphone"></i>' 
            : '<i class="fa-solid fa-microphone-slash"></i>';
        
        // Thông báo trạng thái
        addMessageToUI("Hệ thống", `Microphone ${isMicOn ? 'bật' : 'tắt'}`, 'system');
    };
    
    btnCam.onclick = () => {
        if (!localStream) return;
        
        isCamOn = !isCamOn;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = isCamOn;
        }
        btnCam.classList.toggle('red-state', !isCamOn);
        btnCam.innerHTML = isCamOn 
            ? '<i class="fa-solid fa-video"></i>' 
            : '<i class="fa-solid fa-video-slash"></i>';
        
        // Thông báo trạng thái
        addMessageToUI("Hệ thống", `Camera ${isCamOn ? 'bật' : 'tắt'}`, 'system');
    };
}

// Hàm kiểm tra WebRTC support
function checkWebRTCSupport() {
    const requiredAPIs = [
        'RTCPeerConnection',
        'RTCSessionDescription',
        'RTCIceCandidate',
        'navigator.mediaDevices.getUserMedia',
        'navigator.mediaDevices.getDisplayMedia'
    ];
    
    for (const api of requiredAPIs) {
        if (!window[api] && !navigator.mediaDevices?.getUserMedia) {
            console.error(`❌ ${api} không được hỗ trợ`);
            return false;
        }
    }
    
    console.log("✅ WebRTC được hỗ trợ đầy đủ");
    return true;
}

// Kiểm tra khi trang load
window.addEventListener('load', () => {
    if (!checkWebRTCSupport()) {
        alert("⚠️ Trình duyệt của bạn không hỗ trợ WebRTC hoặc đã lỗi thời.\n\nVui lòng sử dụng:\n- Google Chrome (bản mới nhất)\n- Microsoft Edge (bản mới nhất)\n- Firefox (bản mới nhất)\n\nSafari trên iOS/Mac cần bật WebRTC trong cài đặt.");
    }
    
    // Test kết nối socket
    socket.on('connect', () => {
        console.log("✅ Kết nối Socket.IO thành công!");
    });
    
    socket.on('connect_error', (err) => {
        console.error("❌ Lỗi kết nối Socket.IO:", err.message);
        alert("Không thể kết nối đến server. Vui lòng kiểm tra mạng và thử lại.");
    });
});

// Xử lý khi đóng trang
window.addEventListener('beforeunload', () => {
    if (peerConnection) {
        peerConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    // Thông báo rời phòng
    if (currentRoom) {
        socket.emit('leave-room', { roomID: currentRoom });
    }
});

// Hàm thử kết nối lại
function reconnectWebRTC() {
    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        connectionAttempts++;
        console.log(`🔄 Thử kết nối lại WebRTC (lần ${connectionAttempts})...`);
        
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        
        setTimeout(() => {
            createPeerConnection();
            if (localStream && peerConnection) {
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });
            }
        }, 1000 * connectionAttempts);
    }
}

// --- THÊM NÚT KẾT NỐI LẠI ---
function addReconnectButton() {
    const bottomBar = document.querySelector('.bottom-bar');
    if (!bottomBar) return;
    
    const reconnectBtn = document.createElement('button');
    reconnectBtn.id = 'btnReconnect';
    reconnectBtn.className = 'control-btn';
    reconnectBtn.title = 'Kết nối lại video';
    reconnectBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    reconnectBtn.style.background = '#fbbc05';
    reconnectBtn.style.color = '#202124';
    
    reconnectBtn.onclick = () => {
        reconnectWebRTC();
        addMessageToUI("Hệ thống", "Đang thử kết nối lại video...", 'system');
    };
    
    // Chèn vào trước nút rời phòng
    const hangupBtn = document.querySelector('.hangup-btn');
    if (hangupBtn) {
        bottomBar.querySelector('.center-controls').insertBefore(reconnectBtn, hangupBtn);
    }
}

// Gọi hàm thêm nút reconnect khi vào phòng
socket.on('room-success', () => {
    setTimeout(addReconnectButton, 1000);
});