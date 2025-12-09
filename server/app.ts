import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

interface SessionParticipant {
  id: string;
  socket: WebSocket;
}

type SessionMap = Map<string, SessionParticipant[]>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sessions: SessionMap = new Map();

app.use(express.json());

app.post('/api/sessions', (_req, res) => {
  const id = randomUUID();
  sessions.set(id, []);
  res.json({ id });
});

app.get('/api/sessions/:id', (req, res) => {
  const exists = sessions.has(req.params.id);
  if (!exists) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({ id: req.params.id, participants: sessions.get(req.params.id)?.length ?? 0 });
});

const clientPath = path.resolve(__dirname, '../../client');
app.use(express.static(clientPath));

function getSessionParticipants(sessionId: string): SessionParticipant[] {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }
  return sessions.get(sessionId)!;
}

function broadcast(sessionId: string, message: unknown, senderId: string) {
  const participants = sessions.get(sessionId) ?? [];
  for (const participant of participants) {
    if (participant.id === senderId) continue;
    participant.socket.send(JSON.stringify(message));
  }
}

wss.on('connection', (socket) => {
  const clientId = randomUUID();
  let sessionId: string | null = null;

  const welcomeMessage = { type: 'welcome', payload: { clientId } };
  socket.send(JSON.stringify(welcomeMessage));

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      const { type, payload, targetId } = parsed;

      if (type === 'join') {
        sessionId = payload?.sessionId;
        if (!sessionId) return;
        const participants = getSessionParticipants(sessionId);
        participants.push({ id: clientId, socket });
        const joinMsg = { type: 'join', senderId: clientId, payload: payload ?? {} };
        broadcast(sessionId, joinMsg, clientId);
        return;
      }

      if (!sessionId) return;

      const relayMessage = { type, payload, senderId: clientId, targetId };
      broadcast(sessionId, relayMessage, clientId);
    } catch (err) {
      console.error('Failed to process message', err);
    }
  });

  socket.on('close', () => {
    if (!sessionId) return;
    const participants = sessions.get(sessionId);
    if (!participants) return;
    const filtered = participants.filter((p) => p.id !== clientId);
    sessions.set(sessionId, filtered);
    const leaveMsg = { type: 'leave', senderId: clientId };
    broadcast(sessionId, leaveMsg, clientId);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
