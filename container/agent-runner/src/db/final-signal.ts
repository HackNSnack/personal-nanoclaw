/**
 * Cross-process "the model is done" signal.
 *
 * mcp-tools runs as a separate OS subprocess (a stdio MCP server spawned by
 * index.ts), so an in-memory flag set in poll-loop.ts's process can never be
 * observed by a tool call handled in that subprocess. Both processes already
 * share outbound.db (a real SQLite file on the container's own filesystem),
 * so a tiny counter row there is the cheapest reliable way to cross that
 * boundary: the send_message(final:true) and end_turn tool handlers
 * (mcp-tools/core.ts) bump this counter, and poll-loop.ts polls it —
 * comparing against the value it last saw — to decide, deterministically,
 * whether a turn actually finished.
 *
 * This replaces inferring completion from text shape (trailing scratchpad,
 * DONE sentinels, echo-matching against outbound.db): those heuristics let a
 * model announce "I will now do X" via send_message and have the turn
 * counted as delivered/complete even though no further work ever happened.
 * A structured tool call the model either makes or doesn't is a binary
 * signal; free text is not.
 */
import { getOutboundDb } from './connection.js';

const KEY = 'final_signal_count';

function readCount(): number {
  const row = getOutboundDb().prepare('SELECT value FROM session_state WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined;
  return row ? Number(row.value) || 0 : 0;
}

/** Called by send_message(final:true) and end_turn — marks the current turn done. */
export function bumpFinalSignal(): void {
  const next = readCount() + 1;
  getOutboundDb()
    .prepare('INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(KEY, String(next), new Date().toISOString());
}

/**
 * Current signal count. poll-loop.ts snapshots this before/after each turn;
 * an increase means final was signaled at some point during that turn.
 */
export function getFinalSignalCount(): number {
  return readCount();
}
