/**
 * Persistent key/value state for the container. Lives in outbound.db
 * (container-owned, already scoped per channel/thread).
 *
 * Primary use: remember each provider's opaque continuation id so the
 * agent's conversation resumes across container restarts. Keyed per
 * provider because continuations are provider-private — a Claude
 * conversation id means nothing to Codex and vice versa. Switching
 * providers is therefore lossless: each provider's last thread stays
 * on file and resumes cleanly if the user flips back.
 */
import { getOutboundDb } from './connection.js';

const LEGACY_KEY = 'sdk_session_id';

function continuationKey(providerName: string): string {
  return `continuation:${providerName.toLowerCase()}`;
}

function wedgeStrikeKey(providerName: string): string {
  return `continuation-wedge-strikes:${providerName.toLowerCase()}`;
}

function postInitWedgeStrikeKey(providerName: string): string {
  return `continuation-postinit-wedge-strikes:${providerName.toLowerCase()}`;
}

function postInitWedgeAtKey(providerName: string): string {
  return `continuation-postinit-wedge-at:${providerName.toLowerCase()}`;
}

function getValue(key: string): string | undefined {
  const row = getOutboundDb()
    .prepare('SELECT value FROM session_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

function setValue(key: string, value: string): void {
  getOutboundDb()
    .prepare('INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, value, new Date().toISOString());
}

function deleteValue(key: string): void {
  getOutboundDb().prepare('DELETE FROM session_state WHERE key = ?').run(key);
}

/**
 * One-time migration of the pre-per-provider continuation row.
 *
 * Before this was keyed per provider, continuations lived under the
 * single key `sdk_session_id`. On container start, if that legacy row
 * exists and the current provider has no continuation of its own, adopt
 * the legacy value into the current provider's slot (best-guess — the
 * legacy row was written by whatever provider ran last). The legacy row
 * is always deleted so future provider flips never re-read a stale id
 * through the wrong lens.
 *
 * Returns the continuation the caller should use at startup (either the
 * current provider's existing value, the adopted legacy value, or
 * undefined).
 */
export function migrateLegacyContinuation(providerName: string): string | undefined {
  const legacy = getValue(LEGACY_KEY);
  const currentKey = continuationKey(providerName);
  const current = getValue(currentKey);

  if (legacy === undefined) return current;

  // Always drop the legacy row so no future provider reads it.
  deleteValue(LEGACY_KEY);

  // Prefer the current provider's own slot if one already exists.
  if (current !== undefined) return current;

  setValue(currentKey, legacy);
  return legacy;
}

export function getContinuation(providerName: string): string | undefined {
  return getValue(continuationKey(providerName));
}

export function setContinuation(providerName: string, id: string): void {
  // Strikes are scoped to a single continuation value, but stored per provider
  // slot. When the id actually changes, the old continuation is retired — its
  // silent strike count must not carry over onto the new one, or a fresh
  // continuation could inherit a leftover strike and get cleared on its
  // first-ever wedge (silent limit is 2). Only the silent counter resets here;
  // the post-init counter is decoupled from id identity so a benign id change
  // (failed-resume fallback) can't drop in-progress post-init cluster history —
  // it clears only via clearContinuation or its own wall-clock decay.
  if (getValue(continuationKey(providerName)) !== id) {
    resetWedgeStrikes(providerName);
  }
  setValue(continuationKey(providerName), id);
}

export function clearContinuation(providerName: string): void {
  deleteValue(continuationKey(providerName));
  // The continuation is gone — every wedge-strike count is meaningless now.
  // Wipe both counters (silent + post-init); this is the one place that clears
  // the post-init history outside its own wall-clock decay.
  resetWedgeStrikes(providerName);
  resetPostInitWedgeStrikes(providerName);
}

/**
 * Per-continuation watchdog-76 wedge counter. When a resume wedges the LLM
 * turn (no SDK events) the watchdog self-exits(76) before processQuery
 * returns, so the graceful apiError clear path never runs. We count
 * consecutive wedges here and clear the poisoned continuation once the count
 * hits WEDGE_STRIKE_LIMIT, self-healing a session that would otherwise
 * crash-loop forever on respawn.
 */
export function bumpWedgeStrikes(providerName: string): number {
  const key = wedgeStrikeKey(providerName);
  const next = (Number(getValue(key)) || 0) + 1;
  setValue(key, String(next));
  return next;
}

export function resetWedgeStrikes(providerName: string): void {
  // Silent counter only. Its reset lifecycle (healthy turn, id change) is
  // deliberately decoupled from the post-init counter: the silent path heals
  // at limit 2, so an inherited strike + one wedge would clear immediately — it
  // must reset on a benign id change. The post-init counter tracks poison over
  // wall-clock time and resets via its own decay, so it must NOT be wiped by
  // id bookkeeping or a healthy silent turn.
  deleteValue(wedgeStrikeKey(providerName));
}

/**
 * Post-init wedge counter with a wall-clock decay. A cold resume that emits
 * `init` (transcript reload proven healthy) but then hangs is more likely a
 * transient downstream stall than poison — so this path gets a higher limit
 * and forgets isolated wedges: a wedge more than `decayMs` after the previous
 * one resets to 1. Only clustered wedges (deterministic poison, respawning in
 * seconds) climb to the limit and clear.
 */
export function bumpPostInitWedgeStrikes(providerName: string, decayMs: number): number {
  const now = Date.now();
  const lastAt = Number(getValue(postInitWedgeAtKey(providerName))) || 0;
  const prev = Number(getValue(postInitWedgeStrikeKey(providerName))) || 0;
  const next = lastAt && now - lastAt <= decayMs ? prev + 1 : 1;
  setValue(postInitWedgeStrikeKey(providerName), String(next));
  setValue(postInitWedgeAtKey(providerName), String(now));
  return next;
}

export function resetPostInitWedgeStrikes(providerName: string): void {
  deleteValue(postInitWedgeStrikeKey(providerName));
  deleteValue(postInitWedgeAtKey(providerName));
}
