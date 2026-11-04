// The MCP tools: what an LLM agent calls to play skirm. One external agent token plays one of its
// player's agents in practice against the greedy bot (or casual): queue a match, read the turn
// (the fogged observation and its legal actions), answer it before the deadline, repeat.
import { SkirmApiError, type SkirmAgentClient } from './client';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const ACTION_SCHEMA = {
  type: 'object',
  description: 'Exactly one entry of observation.legal, copied as is.',
  required: ['type'],
  properties: {
    type: { enum: ['wait', 'move', 'verb', 'switch'] },
    dir: { enum: ['N', 'E', 'S', 'W'] },
    verb: { type: 'string' },
  },
};

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'list_matches',
    description: "Your player's latest skirm matches (practice, casual, ranked), newest first, with result and score.",
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
  },
  {
    name: 'queue_practice',
    description:
      'Start a practice match against the greedy bot with the agent this token plays (free on the greedy server). It is accepted and locked in for you; then call get_observation every tick. Maps: copper-hollow (default) and the others on the atlas; difficulty easy (default), normal, hard, agentic, mega.',
    inputSchema: {
      type: 'object',
      properties: { mapId: { type: 'string' }, difficulty: { enum: ['easy', 'normal', 'hard', 'agentic', 'mega'] } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_observation',
    description:
      'The open turn for your agent: turnId, tick, deadlineMs, the fogged observation (rows of the board as seen, you, teammates, rivals in sight, score, heard messages) and observation.legal, the actions you may take. Waits up to waitMs (default 5000) for the next turn. Answer with submit_action before the deadline (about 1.2 s) or the greedy brain plays that tick for you.',
    inputSchema: { type: 'object', properties: { waitMs: { type: 'integer', minimum: 0, maximum: 25000 } }, additionalProperties: false },
  },
  {
    name: 'submit_action',
    description: 'Answer a turn: one action from observation.legal, optionally a line to say (when context.canSpeak) and a short inner voice (your crew sees it).',
    inputSchema: {
      type: 'object',
      required: ['turnId', 'action'],
      properties: {
        turnId: { type: 'string' },
        action: ACTION_SCHEMA,
        say: { type: 'object', required: ['channel', 'text'], properties: { channel: { enum: ['team', 'say'] }, text: { type: 'string', maxLength: 160 } } },
        thought: { type: 'string', maxLength: 80 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_match_status',
    description: 'Where the practice match started with queue_practice stands: found, lockin, live (tick, score) or ended (result).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (v: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Runs one tool. Errors from skirm come back as a tool error (isError), never a protocol error. */
export class ToolRunner {
  /** The last turn answered, so get_observation waits for the next one. */
  private answered: string | undefined;

  constructor(private readonly client: SkirmAgentClient) {}

  async call(name: string, rawArgs: unknown): Promise<ToolResult> {
    const args = obj(rawArgs);
    try {
      switch (name) {
        case 'list_matches': {
          const limit = typeof args.limit === 'number' ? Math.min(50, Math.max(1, Math.floor(args.limit))) : 10;
          return ok(await this.client.matches(limit));
        }
        case 'queue_practice': {
          const s = await this.client.queuePractice({
            ...(typeof args.mapId === 'string' ? { mapId: args.mapId } : {}),
            ...(typeof args.difficulty === 'string' ? { difficulty: args.difficulty as never } : {}),
          });
          return ok({ ...s, next: 'call get_observation to get your first turn' });
        }
        case 'get_observation': {
          const waitMs = typeof args.waitMs === 'number' ? Math.min(25_000, Math.max(0, Math.floor(args.waitMs))) : 5000;
          const r = await this.client.turn(waitMs, this.answered);
          if (!r.turn) return ok({ turn: null, status: this.client.status, hint: 'no open turn: the match may not be live yet, or it ended' });
          return ok(r.turn);
        }
        case 'submit_action': {
          if (typeof args.turnId !== 'string' || !args.turnId) return fail('submit_action needs a turnId');
          if (typeof args.action !== 'object' || args.action === null) return fail('submit_action needs an action from observation.legal');
          const r = await this.client.action({
            turnId: args.turnId,
            action: args.action,
            ...(args.say !== undefined ? { say: args.say } : {}),
            ...(args.thought !== undefined ? { thought: args.thought } : {}),
          });
          this.answered = args.turnId;
          return ok(r);
        }
        case 'get_match_status':
          return ok({ status: this.client.status });
        default:
          return fail(`unknown tool ${name}`);
      }
    } catch (err) {
      if (err instanceof SkirmApiError) {
        // A stale or late turn is answered: wait for the next one rather than this again.
        if (name === 'submit_action' && (err.code === 'stale_turn' || err.code === 'too_late' || err.code === 'already_answered')) this.answered = String(args.turnId);
        return fail(`${err.code}: ${err.message}`);
      }
      return fail((err as Error).message || 'failed');
    }
  }
}
