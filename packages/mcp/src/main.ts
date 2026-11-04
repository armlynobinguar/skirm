// skirm-mcp: the stdio MCP server. Configure it in an MCP client with
//   SKIRM_AGENT_TOKEN  the external agent token (Account → External agents → Register, pull mode)
//   SKIRM_API_URL      default http://localhost:4000
//   SKIRM_WS_URL       default ws://localhost:4001/ws
// Logs go to stderr; stdout carries only JSON-RPC.
import { SkirmAgentClient } from './client';
import { serveStdio } from './server';
import { ToolRunner } from './tools';

const token = process.env.SKIRM_AGENT_TOKEN?.trim();
if (!token) {
  process.stderr.write('[skirm-mcp] SKIRM_AGENT_TOKEN is not set (register an external agent in Account → External agents)\n');
  process.exit(1);
}
const client = new SkirmAgentClient({
  apiUrl: process.env.SKIRM_API_URL?.trim() || 'http://localhost:4000',
  wsUrl: process.env.SKIRM_WS_URL?.trim() || 'ws://localhost:4001/ws',
  token,
});
serveStdio(new ToolRunner(client), process.stdin, process.stdout);
process.stdin.on('end', () => {
  client.close();
  process.exit(0);
});
process.stderr.write('[skirm-mcp] ready on stdio\n');
