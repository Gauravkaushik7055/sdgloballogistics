import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import type { AuthUser } from './auth.ts';
import { db } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'logicore-dev-secret-change-in-production';

interface ConnectedClient {
  ws: WebSocket;
  userId: number;
  role: string;
}

const clientsByUser = new Map<number, Set<ConnectedClient>>();
let wssInstance: WebSocketServer | null = null;

function registerClient(client: ConnectedClient) {
  let set = clientsByUser.get(client.userId);
  if (!set) {
    set = new Set();
    clientsByUser.set(client.userId, set);
  }
  set.add(client);
  broadcastPresence();
}

function unregisterClient(client: ConnectedClient) {
  const set = clientsByUser.get(client.userId);
  if (set) {
    set.delete(client);
    if (set.size === 0) {
      clientsByUser.delete(client.userId);
    }
  }
  broadcastPresence();
}

export function getOnlineUserIds(): number[] {
  return Array.from(clientsByUser.keys());
}

export function sendToUser(userId: number, event: string, payload: unknown) {
  const set = clientsByUser.get(userId);
  if (!set || set.size === 0) return;
  const serialized = JSON.stringify({ event, payload });
  for (const c of set) {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(serialized);
    }
  }
}

export function sendToSuperAdmins(event: string, payload: unknown) {
  const admins = db
    .prepare("SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'super_admin' AND u.status = 'Active'")
    .all() as { id: number }[];
  for (const a of admins) {
    sendToUser(a.id, event, payload);
  }
}

export function broadcastAll(event: string, payload: unknown) {
  const serialized = JSON.stringify({ event, payload });
  for (const set of clientsByUser.values()) {
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(serialized);
      }
    }
  }
}

export function broadcastPresence() {
  const onlineIds = getOnlineUserIds();
  const serialized = JSON.stringify({ event: 'presence:update', payload: { onlineUserIds: onlineIds } });
  for (const set of clientsByUser.values()) {
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(serialized);
      }
    }
  }
}

export function attachRealtimeWebSocket(server: HttpServer) {
  if (wssInstance) return wssInstance;

  const wss = new WebSocketServer({ noServer: true });
  wssInstance = wss;

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws') {
        // Leave other upgrade paths (e.g. Vite) untouched
        return;
      }

      const token = url.searchParams.get('token') || '';
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
      const dbUser = db
        .prepare('SELECT u.id, u.status, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?')
        .get(decoded.id) as { id: number; status: string; role: string } | undefined;

      if (!dbUser || dbUser.status !== 'Active') {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const client: ConnectedClient = { ws, userId: dbUser.id, role: dbUser.role };
        registerClient(client);

        ws.send(JSON.stringify({ event: 'presence:update', payload: { onlineUserIds: getOnlineUserIds() } }));

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg?.event === 'ping') {
              ws.send(JSON.stringify({ event: 'pong', payload: { ts: Date.now() } }));
            }
          } catch {
            // ignore malformed frames
          }
        });

        ws.on('close', () => {
          unregisterClient(client);
        });
        ws.on('error', () => {
          unregisterClient(client);
        });
      });
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  return wss;
}
