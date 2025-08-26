const socket = io();
const statusEl = document.getElementById('status');
const roomInput = document.getElementById('room');
const btnJoin = document.getElementById('btn-join');
const btnLeave = document.getElementById('btn-leave');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let pc;
let localStream;
let roomId;
let makingOffer = false;
let ignoreOffer = false;

const rtcConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
};

function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
  console.log(`[STATUS] ${text}`);
}

function setInCallUI(inCall) {
  btnJoin.disabled = inCall;
  roomInput.disabled = inCall;
  btnLeave.disabled = !inCall;
}

async function initLocalMedia() {
  try {
    console.log('[DEBUG] Mencoba akses kamera/mic...');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    console.log('[DEBUG] Local stream siap:', localStream);
    return localStream;
  } catch (err) {
    console.error('[ERROR] Gagal akses kamera/mic:', err);
    alert('Tidak bisa akses kamera/mic. Pastikan izin diberikan dan browser mendukung HTTPS.');
    throw err;
  }
}

function createPeerConnection() {
  console.log('[DEBUG] Membuat RTCPeerConnection...');
  pc = new RTCPeerConnection(rtcConfig);

  pc.ontrack = ev => {
    console.log('[DEBUG] Remote track diterima:', ev.streams[0]);
    remoteVideo.srcObject = ev.streams[0];
  };

  pc.onicecandidate = ev => {
    if (ev.candidate) {
      console.log('[DEBUG] Mengirim ICE candidate:', ev.candidate);
      socket.emit('signal', { roomId, data: { type: 'candidate', candidate: ev.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[DEBUG] PC state:', pc.connectionState);
    setStatus(`PC state: ${pc.connectionState}`);
  };

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      console.log('[DEBUG] onnegotiationneeded: membuat offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { roomId, data: { type: 'offer', sdp: pc.localDescription } });
      console.log('[DEBUG] Offer dikirim:', offer);
    } catch (err) {
      console.error('[ERROR] Negosiasi gagal:', err);
    } finally {
      makingOffer = false;
    }
  };

  return pc;
}

async function addLocalTracks() {
  const stream = await initLocalMedia();
  stream.getTracks().forEach(track => {
    pc.addTrack(track, stream);
    console.log('[DEBUG] Menambahkan track ke PC:', track.kind);
  });
}

async function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId) return alert('Masukkan ID Room terlebih dahulu.');

  console.log('[DEBUG] Bergabung ke room:', roomId);
  setStatus('Menghubungkan...');
  createPeerConnection();
  await addLocalTracks();
  socket.emit('join', roomId);
  setInCallUI(true);
}

async function leaveRoom() {
  console.log('[DEBUG] Meninggalkan room...');
  if (pc) {
    pc.getSenders().forEach(sender => sender.track?.stop());
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  setInCallUI(false);
  setStatus('Panggilan ditutup.');
  roomId = null;
}

btnJoin.onclick = joinRoom;
btnLeave.onclick = leaveRoom;

// Socket.io events
socket.on('room_full', () => {
  console.warn('[DEBUG] Room penuh');
  setStatus('Room penuh (maks 2 orang).');
  setInCallUI(false);
});

socket.on('ready', async () => {
  console.log('[DEBUG] Peer siap, mulai negosiasi jika perlu...');
  setStatus('Peer siap. Negosiasi akan dimulai...');
});

socket.on('signal', async (data) => {
  console.log('[DEBUG] Signal diterima:', data);
  try {
    if (!pc) {
      console.log('[DEBUG] PC belum dibuat, buat sekarang...');
      createPeerConnection();
      await addLocalTracks();
    }

    if (data.type === 'offer') {
      const offerCollision = makingOffer || pc.signalingState !== 'stable';
      ignoreOffer = offerCollision;
      if (ignoreOffer) {
        console.warn('[DEBUG] Offer collision, diabaikan');
        return;
      }

      console.log('[DEBUG] Menerima offer, membuat answer...');
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { roomId, data: { type: 'answer', sdp: pc.localDescription } });
      console.log('[DEBUG] Answer dikirim:', answer);
    } else if (data.type === 'answer') {
      console.log('[DEBUG] Menerima answer, set remote description...');
      await pc.setRemoteDescription(data.sdp);
    } else if (data.type === 'candidate') {
      try {
        await pc.addIceCandidate(data.candidate);
        console.log('[DEBUG] ICE candidate ditambahkan');
      } catch (err) {
        if (!ignoreOffer) console.error('[ERROR] Tambah ICE candidate gagal:', err);
      }
    }
  } catch (err) {
    console.error('[ERROR] Signal handling error:', err);
  }
});

socket.on('peer_disconnect', () => {
  console.log('[DEBUG] Peer disconnect');
  setStatus('Peer meninggalkan panggilan.');
});
