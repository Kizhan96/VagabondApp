const startBtn = document.getElementById('startBtn');
const sessionInfo = document.getElementById('sessionInfo');
const sessionIdEl = document.getElementById('sessionId');
const viewerLink = document.getElementById('viewerLink');
const preview = document.getElementById('preview');
const logEl = document.getElementById('log');

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
];

let ws;
let clientId = null;
let screenStream = null;
const peers = new Map();

function log(message) {
  logEl.textContent += `\n${message}`;
}

function ensureWebSocket(sessionId) {
  if (ws) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    const { type, payload, senderId, targetId } = message;

    if (type === 'welcome') {
      clientId = payload.clientId;
      ws.send(JSON.stringify({ type: 'join', payload: { sessionId, role: 'presenter' } }));
      log(`Подключились к сигналингу как ${clientId}`);
      return;
    }

    if (targetId && targetId !== clientId) return;

    if (type === 'join' && payload?.role === 'viewer') {
      log(`Зритель подключился (${senderId}). Отправляем offer.`);
      createOfferForViewer(senderId);
      return;
    }

    if (type === 'answer') {
      const peer = peers.get(senderId);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(payload));
      }
      return;
    }

    if (type === 'ice-candidate') {
      const peer = peers.get(senderId);
      if (peer && payload?.candidate) {
        try {
          await peer.addIceCandidate(payload.candidate);
        } catch (err) {
          console.error('Failed to add ICE candidate', err);
        }
      }
    }
  };
}

async function createOfferForViewer(viewerId) {
  if (!screenStream) return;
  const peer = new RTCPeerConnection({ iceServers });
  peers.set(viewerId, peer);

  screenStream.getTracks().forEach((track) => peer.addTrack(track, screenStream));

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(
        JSON.stringify({ type: 'ice-candidate', targetId: viewerId, payload: { candidate: event.candidate } }),
      );
    }
  };

  peer.onconnectionstatechange = () => {
    log(`Peer ${viewerId} state: ${peer.connectionState}`);
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', targetId: viewerId, payload: offer }));
}

async function startSharing() {
  startBtn.disabled = true;
  try {
    const response = await fetch('/api/sessions', { method: 'POST' });
    const { id } = await response.json();

    ensureWebSocket(id);

    const url = new URL(location.href);
    url.pathname = `/viewer/`;
    url.searchParams.set('sessionId', id);
    viewerLink.href = url.toString();
    viewerLink.textContent = url.toString();
    sessionIdEl.textContent = id;
    sessionInfo.hidden = false;

    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    preview.srcObject = screenStream;
    log('Захват экрана включён. Ждём зрителей...');
  } catch (err) {
    console.error(err);
    log('Не удалось начать трансляцию');
    startBtn.disabled = false;
  }
}

startBtn.addEventListener('click', startSharing);
