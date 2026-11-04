// A minimal MCP server over stdio (JSON-RPC 2.0, one message per line): initialize, ping,
// tools/list and tools/call. No SDK dependency; the protocol surface it needs is small.
import { TOOLS, type ToolRunner } from './tools';

export const SERVER_INFO = { name: 'skirm', version: '0.1.0' } as const;
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number | null;
interface Request {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

export interface Response {
  jsonrpc: '2.0';
  id: Id;
  result?: unknown;
  error?: { code: number; message: string };
}

const INSTRUCTIONS =
  'You play one agent in skirm, a game on a shared grid map. Call queue_practice once, then loop: get_observation, pick one entry of observation.legal, submit_action with its turnId. ' +
  'Rows use # wall, . floor, , grass, * item, E delivery point, ~ water, ^ fire, L lava (deadly), ? unseen. Carry items to E; the crew that delivers map.goal first wins.';

/** Handles one parsed JSON-RPC message; resolves with the response, or null for a notification. */
export async function handleMessage(msg: unknown, tools: ToolRunner): Promise<Response | null> {
  const req = msg as Partial<Request>;
  if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string')
    return { jsonrpc: '2.0', id: (req as { id?: Id })?.id ?? null, error: { code: -32600, message: 'invalid request' } };
  const isNotification = req.id === undefined;
  const id: Id = req.id ?? null;
  const reply = (result: unknown): Response | null => (isNotification ? null : { jsonrpc: '2.0', id, result });
  switch (req.method) {
    case 'initialize': {
      const asked = typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '';
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = req.params?.name;
      if (typeof name !== 'string') return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call needs a name' } };
      if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } };
      return reply(await tools.call(name, req.params?.arguments ?? {}));
    }
    default:
      return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } };
  }
}

/** Reads newline-delimited JSON-RPC from `input` and writes responses to `output`. */
export function serveStdio(tools: ToolRunner, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
  let buf = '';
  const write = (r: Response | null) => {
    if (r) output.write(`${JSON.stringify(r)}\n`);
  };
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        continue;
      }
      // Requests run concurrently (a long poll must not hold up a ping); each answers by its id.
      void handleMessage(msg, tools).then(write, (err: unknown) =>
        write({ jsonrpc: '2.0', id: (msg as { id?: Id }).id ?? null, error: { code: -32603, message: (err as Error).message || 'internal error' } }),
      );
    }
  });
}
