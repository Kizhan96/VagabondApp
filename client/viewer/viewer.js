const joinBtn = document.getElementById('join');
const sessionInput = document.getElementById('session');
const remoteVideo = document.getElementById('remoteVideo');
const logEl = document.getElementById('log');

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
];

let ws;
let clientId = null;
let presenterId = null;
let peer = null;

function log(message) {
  logEl.textContent += `\n${message}`;
}

function ensureWebSocket(sessionId) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    const { type, payload, senderId, targetId } = message;

    if (type === 'welcome') {
      clientId = payload.clientId;
      ws.send(JSON.stringify({ type: 'join', payload: { sessionId, role: 'viewer' } }));
      log(`Подключились к сигналингу как ${clientId}`);
      return;
    }

    if (targetId && targetId !== clientId) return;

    if (type === 'offer') {
      presenterId = senderId;
      await handleOffer(payload);
      return;
    }

    if (type === 'ice-candidate' && peer && payload?.candidate) {
      try {
        await peer.addIceCandidate(payload.candidate);
      } catch (err) {
        console.error('Failed to add ICE candidate', err);
      }
    }
  };
}

async function handleOffer(offer) {
  peer = new RTCPeerConnection({ iceServers });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(
        JSON.stringify({ type: 'ice-candidate', targetId: presenterId, payload: { candidate: event.candidate } }),
      );
    }
  };

  peer.ontrack = (event) => {
    const [stream] = event.streams;
    remoteVideo.srcObject = stream;
    log('Получили видеопоток от ведущего');
  };

  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: 'answer', targetId: presenterId, payload: answer }));
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('sessionId');
  if (fromUrl) {
    sessionInput.value = fromUrl;
  }
}

joinBtn.addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) {
    log('Введите ID сессии');
    return;
  }
  ensureWebSocket(sessionId);
  joinBtn.disabled = true;
});

prefillFromUrl();
