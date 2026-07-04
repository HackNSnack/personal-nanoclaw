/**
 * Destination map — lives in inbound.db's `destinations` table.
 *
 * The host writes this table before every container wake AND on demand
 * (e.g. when a new child agent is created mid-session). The container
 * queries the table live on every lookup, so admin changes take effect
 * immediately — no restart required.
 *
 * This table is BOTH the routing map and the container-visible ACL.
 * The host re-validates on the delivery side against the central DB,
 * so even if this table is stale the host's enforcement is authoritative.
 */
import { getInboundDb } from './db/connection.js';

export interface DestinationEntry {
  name: string;
  displayName: string;
  type: 'channel' | 'agent';
  channelType?: string;
  platformId?: string;
  agentGroupId?: string;
}

interface DestRow {
  name: string;
  display_name: string | null;
  type: 'channel' | 'agent';
  channel_type: string | null;
  platform_id: string | null;
  agent_group_id: string | null;
}

function rowToEntry(row: DestRow): DestinationEntry {
  return {
    name: row.name,
    displayName: row.display_name ?? row.name,
    type: row.type,
    channelType: row.channel_type ?? undefined,
    platformId: row.platform_id ?? undefined,
    agentGroupId: row.agent_group_id ?? undefined,
  };
}

export function getAllDestinations(): DestinationEntry[] {
  const rows = getInboundDb().prepare('SELECT * FROM destinations ORDER BY name').all() as DestRow[];
  return rows.map(rowToEntry);
}

export function findByName(name: string): DestinationEntry | undefined {
  const row = getInboundDb().prepare('SELECT * FROM destinations WHERE name = ?').get(name) as DestRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

/**
 * Reverse lookup: given routing fields from an inbound message, find
 * which destination they correspond to (what does this agent call the sender?).
 */
export function findByRouting(
  channelType: string | null | undefined,
  platformId: string | null | undefined,
): DestinationEntry | undefined {
  if (!channelType || !platformId) return undefined;
  const db = getInboundDb();
  const row =
    channelType === 'agent'
      ? (db.prepare("SELECT * FROM destinations WHERE type = 'agent' AND agent_group_id = ?").get(platformId) as
          | DestRow
          | undefined)
      : (db
          .prepare("SELECT * FROM destinations WHERE type = 'channel' AND channel_type = ? AND platform_id = ?")
          .get(channelType, platformId) as DestRow | undefined);
  return row ? rowToEntry(row) : undefined;
}

/**
 * Generate the system-prompt addendum: agent identity + destination map.
 *
 * Identity is injected here (not in the shared CLAUDE.md) because it's
 * per-agent-group and changes when the operator renames an agent, while
 * the shared base is identical across all agents.
 *
 * `provider` controls which delivery model is described:
 * - 'opencode' (DeepSeek, Mistral, etc.): use the `send_message` MCP tool
 *   as the sole delivery path — call it as many times as needed (status
 *   updates, then the final answer). Text output is scratchpad only.
 * - everything else (Claude): use `<message to="name">` text blocks.
 */
export function buildSystemPromptAddendum(assistantName?: string, provider?: string): string {
  const sections: string[] = [];

  if (assistantName) {
    sections.push(
      [
        '# You are ' + assistantName,
        '',
        `Your name is **${assistantName}**. Use it when the channel asks who you are, when introducing yourself, and when signing any message that explicitly calls for a signature.`,
      ].join('\n'),
    );
  }

  sections.push(buildDestinationsSection(provider));

  return sections.join('\n\n');
}

function buildDestinationsSection(provider?: string): string {
  const useSendMessage = provider === 'opencode';
  const all = getAllDestinations();

  if (all.length === 0) {
    return [
      '## Sending messages',
      '',
      'You currently have no configured destinations. You cannot send messages until an admin wires one up.',
    ].join('\n');
  }

  // The delivery rule comes first — models weight earlier system-prompt
  // content more heavily, and this rule must never lose out to whatever
  // follows it (the destination list here, or later fragment content).
  const lines = ['## Sending messages', ''];

  if (useSendMessage) {
    // OpenCode / tool-calling delivery model: the model delivers via the
    // send_message MCP tool; text output is scratchpad only. This is the
    // model's SOLE delivery path — there is no <message> text-block
    // fallback for OpenCode providers.
    //
    // End-of-turn rules come FIRST, before the general delivery mechanics.
    // This is the part models most reliably substitute with their own
    // invented sentinel — observed live: a model kept emitting a bare
    // `<finish/>` tag instead of ever calling a tool, turn after turn,
    // despite the rule being stated (just further down, after the general
    // mandate). Leading with it, and explaining what `final` actually means
    // rather than just when to set it, is the fix — see the turn-vs-task
    // distinction below, which is exactly what a model can get wrong even
    // when it DOES try to use `final` correctly.
    lines.push(
      '⚠️ Every request MUST end with exactly one of these two actions — there is no other way to ' +
        "signal you're done, and the request will not close without it:",
    );
    lines.push('- Call `send_message` with `final: true` on your last message, OR');
    lines.push(
      '- Call `end_turn` (no arguments) if you have nothing further to send — e.g. no reply is needed at all, ' +
        'or you already said everything via `send_message`.',
    );
    lines.push('');
    lines.push(
      '`final: true` does NOT mean "the user\'s request is now fully and permanently resolved" — it means ' +
        '"I am about to go quiet and wait for the user; I will not send or call anything else in this turn." ' +
        'Judge it turn-by-turn, not task-by-task:',
    );
    lines.push(
      '- User says "hi", you reply "Hello!" → `final: true`. Trivially short, but nothing more is coming from ' +
        'you until they reply — that alone makes it final.',
    );
    lines.push(
      '- You called `schedule_task` to check in again later and told the user so → `final: true`. The task ' +
        'keeps firing on its own schedule, but YOUR turn — what you are doing right now — is over; the next ' +
        'update comes from a future turn, not this one.',
    );
    lines.push(
      '- You are about to call another tool or send another update within the next few seconds of this same ' +
        'turn → `final: false`. You have not gone quiet yet.',
    );
    lines.push('');
    lines.push(
      'If you genuinely cannot complete the request (missing tool, missing access, etc.), that IS your complete ' +
        "answer — call `send_message` with `final: true` and state plainly what you can't do and why. A promise " +
        'to do something later is not the same as doing it, and is not a valid way to end the request.',
    );
    lines.push('');
    lines.push(
      'Do not invent your own closing signal in text output — a bare `<finish/>` tag, `DONE`, `[END]`, or ' +
        'anything similar does nothing. The only two ways to close a request are the two tool calls above.',
    );
    lines.push('');
    lines.push(
      '⚠️ MANDATORY: Deliver every message — status updates and your final answer — via the `send_message` tool. ' +
        'Call it as many times as you need:',
    );
    lines.push('- Mid-turn, more coming: brief status ("On it", "Searching now") — pass `final: false`');
    lines.push('- Going quiet now: your complete answer — pass `final: true`');
    lines.push('');
    lines.push('Wrap any reasoning in `<internal>…</internal>` — it is never sent.');
    lines.push('');
    lines.push(
      'NEVER put your answer in `<message to="name">` text blocks — that path doesn\'t exist for you. ' +
        'If you output plain text with no tool call, nothing is delivered.',
    );
    lines.push('');
    lines.push(
      '⚠️ Plain text output is not a draft, a preview, or a fallback delivery path — it is discarded outright ' +
        "and silently, no matter how long, complete, or well-written it is. The user's client renders nothing " +
        'except the exact string you pass as `text` in a `send_message` call. There is no mechanism that also ' +
        'sends your response text on the side — if it is not inside a `send_message` (or `send_file`) call, it ' +
        'does not exist to the user, full stop.',
    );
    lines.push('');
    lines.push(
      "If you already composed a complete answer as plain text and are told your turn didn't close, the fix is " +
        'to call `send_message` with that SAME complete answer as `text` — not a shorter stand-in reply written ' +
        'just to satisfy the tool-call requirement. The `text` argument IS the message; nothing you wrote before ' +
        'or after the tool call is appended to it. Shrinking your answer to "get past" the rule delivers a worse ' +
        'response than the one you already had, for no reason — send the real one.',
    );
  } else {
    // Claude / text-block delivery model:
    lines.push(
      'Wrap each delivered message in a `<message to="name">…</message>` block written in your text output; include several blocks to address several destinations. `<internal>…</internal>` marks thinking you don\'t want sent.',
    );
    lines.push('');
    lines.push(
      'IMPORTANT: `<message to="name">…</message>` is TEXT OUTPUT — you write it directly in your response, NOT as a tool call. There is no "message" tool. Do not attempt to call a tool named "message".',
    );
    lines.push('');
    lines.push(
      'When replying to an incoming message, default to addressing the destination it came `from` (every inbound `<message>` tag carries a `from="name"` attribute). Pick a different destination when the request asks for it (e.g., "tell Laura that…").',
    );
    lines.push('');
    lines.push(
      'The `send_message` MCP tool is for brief status updates ONLY ("On it", "Searching now") — NOT for delivering your answer. Your actual answer goes in the closing `<message>` text block. Both paths deliver to the user as separate messages, so putting your answer in BOTH causes duplicates.',
    );
  }

  lines.push('');
  if (all.length === 1) {
    const d = all[0];
    const label = d.displayName && d.displayName !== d.name ? ` (${d.displayName})` : '';
    lines.push(`Your destination is \`${d.name}\`${label}.`);
  } else {
    lines.push('You can send messages to the following destinations:', '');
    for (const d of all) {
      const label = d.displayName && d.displayName !== d.name ? ` (${d.displayName})` : '';
      lines.push(`- \`${d.name}\`${label}`);
    }
  }
  return lines.join('\n');
}
