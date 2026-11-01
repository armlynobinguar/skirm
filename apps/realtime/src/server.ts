// HTTP + WebSocket transport: `GET /health` and the `/ws` endpoint (docs/backend-contract.md).
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RealtimeDeps } from './deps';
import { RealtimeHub } from './hub';
import { MAX_CLIENT_MESSAGE_BYTES } from './protocol';

export const WS_PATH = '/ws';

export interface RealtimeServer {
  readonly hub: RealtimeHub;
  readonly http: Server;
  readonly wss: WebSocketServer;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createRealtimeServer(deps: RealtimeDeps): RealtimeServer {
  const hub = new RealtimeHub(deps);
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clients: hub.clients.size, matches: hub.v2.matches.size }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'not found' } }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });

  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    const client = hub.connect({
      send: (data) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    });
    ws.on('message', (data, isBinary) => {
      void hub.message(client, isBinary ? null : data);
    });
    ws.on('close', () => void hub.disconnect(client));
    ws.on('error', () => void hub.disconnect(client));
  });

  const pingEvery = deps.pingIntervalMs ?? 30_000;
  const pinger =
    pingEvery > 0
      ? setInterval(() => {
          for (const ws of wss.clients) {
            if (alive.get(ws) === false) {
              ws.terminate();
              continue;
            }
            alive.set(ws, false);
            ws.ping();
          }
        }, pingEvery)
      : undefined;
  pinger?.unref();

  return {
    hub,
    http,
    wss,
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          http.off('error', reject);
          resolve((http.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      if (pinger) clearInterval(pinger);
      await hub.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => {
        if (!http.listening) return r();
        http.close(() => r());
        http.closeAllConnections?.();
      });
    },
  };
}
