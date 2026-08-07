import { findByName, getAllDestinations, type DestinationEntry } from './destinations.js';
import { getPendingMessages, markProcessing, markCompleted, type MessageInRow } from './db/messages-in.js';
import { writeMessageOut } from './db/messages-out.js';
import { getFinalSignalCount } from './db/final-signal.js';
import { getInboundDb, touchHeartbeat, clearStaleProcessingAcks, getInFlightTool, type InFlightTool } from './db/connection.js';
import {
  clearContinuation,
  migrateLegacyContinuation,
  setContinuation,
  bumpWedgeStrikes,
  resetWedgeStrikes,
  bumpPostInitWedgeStrikes,
} from './db/session-state.js';
import { clearCurrentInReplyTo, setCurrentInReplyTo } from './current-batch.js';
import {
  formatMessages,
  extractRouting,
  categorizeMessage,
  isClearCommand,
  isStopCommand,
  isRunnerCommand,
  stripInternalTags,
  type RoutingContext,
} from './formatter.js';
import { isUploadTraceCommand, uploadTrace } from './upload-trace.js';
import type { AgentProvider, AgentQuery, AttachmentRef, ProviderEvent, ProviderExchange } from './providers/types.js';

const POLL_INTERVAL_MS = 1000;
const ACTIVE_POLL_INTERVAL_MS = 500;

/**
 * Consecutive truly-empty polls (no rows in messages_in at all) before the
 * container self-exits(0). At the 1000ms poll interval this is ~60s of true
 * silence. The host's wakeContainer path respawns us on the next inbound.
 * Without idle-exit, every container holds its slot + memory for the full
 * 30-min idle ceiling until the sweep force-kills it. Self-exit is the
 * graceful version. Count only `messages.length === 0` — an accumulate-only
 * batch (trigger=0) is queued work, not idle, and must not count toward exit.
 */
export const IDLE_EXIT_POLL_COUNT = 60;

/**
 * Pure decision for whether the poll loop should self-exit this iteration.
 * Inputs are deterministic so the host-sweep wakeContainer cadence can be
 * verified in isolation. Returns the next emptyPollStreak value (caller stores
 * it) and whether to exit. A non-empty batch resets the streak to 0.
 */
export function decideIdleExit(
  args: { hadMessages: boolean; previousStreak: number },
  threshold: number = IDLE_EXIT_POLL_COUNT,
): { nextStreak: number; shouldExit: boolean } {
  if (args.hadMessages) {
    return { nextStreak: 0, shouldExit: false };
  }
  const nextStreak = args.previousStreak + 1;
  return { nextStreak, shouldExit: nextStreak >= threshold };
}

/**
 * Number of consecutive `database disk image is malformed` errors after which
 * the follow-up poll gives up and exits the process. At ACTIVE_POLL_INTERVAL_MS
 * = 500ms this is roughly 5 seconds — long enough to dodge a transient torn
 * read during a host write, short enough to recover quickly from a poisoned
 * page cache (host-sweep then respawns with a fresh mount).
 */
const CORRUPTION_STREAK_EXIT = 10;

/**
 * Heartbeat-silence watchdog: max time an *active* turn may go without emitting
 * a single SDK event before the container self-exits (76) for a host respawn.
 * If the child `claude` binary wedges mid-turn — most often blocked on an LLM
 * upstream socket read we don't own — the query.events loop blocks and the
 * heartbeat freezes with it. Measured normal active-turn gap is ~4-9s, so 120s
 * sits well clear of a slow-but-live step while still being a fraction of the
 * 30-min host ceiling. Env-overridable for tuning without a rebuild.
 */
const HEARTBEAT_WATCHDOG_MS = Number(process.env.HEARTBEAT_WATCHDOG_MS) || 120_000;

/**
 * Consecutive watchdog-76 wedges on the *same* continuation before we clear it
 * as poisoned. A wedge self-exits(76) before processQuery returns, so the
 * graceful apiError clear path never runs — without this a resume that wedges
 * every time crash-loops forever. An unconditional clear on the first wedge
 * would drop a thread's memory on a single transient network stall; the strike
 * counter preserves continuity through a one-off wedge while still self-healing
 * a truly poisoned session on the second respawn. A healthy turn resets it.
 * Env-overridable for tests.
 */
const WEDGE_STRIKE_LIMIT = Number(process.env.WEDGE_STRIKE_LIMIT) || 2;

// Post-init cold-wedge budget: higher than the silent limit because an
// init-then-hang resume is more likely a transient gateway stall than poison.
const POST_INIT_WEDGE_STRIKE_LIMIT = Number(process.env.POST_INIT_WEDGE_STRIKE_LIMIT) || 4;
// A post-init wedge this long after the previous one resets the counter —
// isolated transients decay to nothing; only clustered respawns accumulate.
const POST_INIT_WEDGE_DECAY_MS = Number(process.env.POST_INIT_WEDGE_DECAY_MS) || 15 * 60 * 1000;

/**
 * Grace added to a Bash tool's declared timeout when extending the watchdog
 * deadline. A `git clone` declared at e.g. 300s legitimately emits no SDK events
 * for the whole run; the watchdog must allow the full declared window plus
 * slack for the SDK to surface the PostToolUse result before deciding the turn
 * is wedged. Mirrors the host's `max(CLAIM_STUCK_MS, declaredBashMs)` tolerance
 * (host-sweep.ts) but adds a margin since the container side can't see the
 * host's separate ceiling.
 */
const WATCHDOG_BASH_MARGIN_MS = 30_000;

/**
 * Watchdog ceiling for an in-flight tool that has no declared timeout — every
 * non-Bash tool, plus a default-timeout Bash. The heartbeat ticker keeps the
 * host's liveness view fresh for *any* in-flight tool, so the host has fully
 * delegated "is this tool still healthy" to the container; this self-watchdog
 * is then the only thing bounding such a tool. Mirror the host's absolute
 * ceiling (IDLE_TIMEOUT_MS = 30 min) so the two sides reap an in-flight
 * container at the same bound rather than the container self-killing at the
 * 120s base while the host still sees it alive. Env-overridable.
 */
export const IN_FLIGHT_CEILING_MS = Number(process.env.IN_FLIGHT_CEILING_MS) || 30 * 60 * 1000;

/**
 * Resume-grace window for the phase *before the first SDK event of a turn that
 * resumed a stored continuation*. A cold resume must reload a large `.jsonl`
 * transcript from disk before the SDK emits its first event; on a busy gateway
 * that read + first-token latency can exceed the 120s base with no tool in
 * flight to widen the window. Judged against the bare base, a slow-but-healthy
 * cold resume reads as a wedge — the watchdog exit-76s and two such resumes in
 * a row wipe the thread's memory. Grant the pre-first-event resume phase a
 * generous window so a legitimately-slow reload is never counted as a wedge. A
 * *fresh* (non-resume) turn gets no grace — there is no transcript to reload.
 * Env-overridable.
 */
export const RESUME_GRACE_MS = Number(process.env.RESUME_GRACE_MS) || 5 * 60 * 1000;

/**
 * True for SQLite errors that indicate a corrupt READ view — almost always a
 * cross-mount page-cache coherency issue on Docker Desktop macOS rather than
 * actual file damage (host-side integrity_check passes). Reopening the DB
 * handle inside this process does NOT recover; only a fresh container mount
 * does. Caller's job is to exit so host-sweep respawns the container.
 */
export function isCorruptionError(msg: string): boolean {
  return (
    msg.includes('database disk image is malformed') ||
    msg.includes('SQLITE_CORRUPT') ||
    msg.includes('file is not a database')
  );
}

/**
 * True when the SDK subprocess was killed with SIGKILL — either by the kernel
 * OOM killer (cgroup memory limit exceeded) or by an explicit kill. In either
 * case Bun remains alive but the executor is gone; the container should exit
 * immediately so the host respawns a fresh one rather than looping with a dead
 * claude.exe.
 */
export function isOomKill(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e.signal === 'SIGKILL') return true;
  if (e.code === 137) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return msg.includes('SIGKILL') || msg.includes('ERR_CHILD_PROCESS_KILLED');
}

/** Gateway/SDK errors surfaced as result text (e.g. "API Error: 400 {budget_exceeded}"). */
const API_ERROR_RE = /^API Error:/;

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}]${`[poll-loop] ${msg}`}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PollLoopConfig {
  provider: AgentProvider;
  /**
   * Name of the provider (e.g. "claude", "codex", "opencode"). Used to key
   * the stored continuation per-provider so flipping providers doesn't
   * resurrect a stale id from a different backend.
   */
  providerName: string;
  cwd: string;
  systemContext?: {
    instructions?: string;
  };
  /**
   * Optional stop signal. In production the loop runs until the container
   * dies; tests pass a signal so an abandoned loop actually exits instead of
   * polling forever and stealing messages from the next test's DB.
   */
  signal?: AbortSignal;
}

/**
 * Main poll loop. Runs indefinitely until the process is killed.
 *
 * 1. Poll messages_in for pending rows
 * 2. Format into prompt, call provider.query()
 * 3. While query active: continue polling, push new messages via provider.push()
 * 4. On result: write messages_out
 * 5. Mark messages completed
 * 6. Loop
 */
export async function runPollLoop(config: PollLoopConfig): Promise<void> {
  // Resume the agent's prior session from a previous container run if one
  // was persisted. The continuation is opaque to the poll-loop — the
  // provider decides how to use it (Claude resumes a .jsonl transcript,
  // other providers may reload a thread ID, etc.). Keyed per-provider so
  // a Codex thread id never gets handed to Claude or vice versa.
  let continuation: string | undefined = migrateLegacyContinuation(config.providerName);
  // The container's first query that resumes a stored continuation is a cold
  // `.jsonl` reload; every later turn is warm (transcript already in the live
  // SDK subprocess). Flipped false once a query has run, so the resume-grace
  // window + resume-wedge strike apply to that first cold turn only. A wedge
  // exits the process before this flips, so a crash-looping resume stays "cold"
  // across respawns and keeps striking until it self-heals.
  let coldResumePending = continuation !== undefined;

  // Before resuming, drop a session whose on-disk transcript has grown too
  // large/old to cold-resume within the host's idle ceiling. Without this a
  // long-lived hub keeps trying to reload an ever-growing .jsonl, hangs the
  // first turn, and gets killed before it can reply (then repeats forever).
  if (continuation) {
    const rotateReason = config.provider.maybeRotateContinuation?.(continuation, config.cwd);
    if (rotateReason) {
      log(`Rotating session — ${rotateReason}; starting fresh`);
      clearContinuation(config.providerName);
      continuation = undefined;
    }
  }

  if (continuation) {
    log(`Resuming agent session ${continuation}`);
  }

  // Clear leftover 'processing' acks from a previous crashed container.
  // This lets the new container re-process those messages.
  clearStaleProcessingAcks();

  let pollCount = 0;
  let emptyPollStreak = 0;
  let isFirstPoll = true;
  while (true) {
    if (config.signal?.aborted) return;
    // Skip system messages — they're responses for MCP tools (e.g., ask_user_question)
    const messages = getPendingMessages(isFirstPoll).filter((m) => m.kind !== 'system');
    isFirstPoll = false;
    pollCount++;

    // Periodic heartbeat so we know the loop is alive
    if (pollCount % 30 === 0) {
      log(`Poll heartbeat (${pollCount} iterations, ${messages.length} pending)`);
    }

    if (messages.length === 0) {
      const { nextStreak, shouldExit } = decideIdleExit({
        hadMessages: false,
        previousStreak: emptyPollStreak,
      });
      emptyPollStreak = nextStreak;
      if (shouldExit) {
        log(`Idle exit — ${emptyPollStreak} consecutive empty polls (~${emptyPollStreak}s). Host respawns on next inbound.`);
        process.exit(0);
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    // A non-empty batch resets the idle streak — but an accumulate-only batch
    // (trigger=0) is queued context, not active work, so it neither counts as
    // idle (it carries pending rows) nor resets via the hadMessages path below.
    if (messages.some((m) => m.trigger === 1)) {
      emptyPollStreak = 0;
    }

    // Accumulate gate: if the batch contains only trigger=0 rows
    // (context-only, router-stored under ignored_message_policy='accumulate'),
    // don't wake the agent. Leave them `pending` — they'll ride along the
    // next time a real trigger=1 message lands via this same getPendingMessages
    // query. Without this gate, a warm container keeps processing
    // (and potentially responding to) every accumulate-only batch, defeating
    // the "store as context, don't engage" contract. Host-side countDueMessages
    // gates the same way for wake-from-cold (see src/db/session-db.ts).
    if (!messages.some((m) => m.trigger === 1)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const ids = messages.map((m) => m.id);
    markProcessing(ids);

    const routing = extractRouting(messages);

    // Command handling: the host router gates filtered and unauthorized
    // admin commands before they reach the container. The only command
    // the runner handles directly is /clear (session reset).
    const normalMessages: MessageInRow[] = [];
    const commandIds: string[] = [];

    for (const msg of messages) {
      if ((msg.kind === 'chat' || msg.kind === 'chat-sdk') && isClearCommand(msg)) {
        log('Clearing session (resetting continuation)');
        continuation = undefined;
        clearContinuation(config.providerName);
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: 'Session cleared.' }),
        });
        commandIds.push(msg.id);
        continue;
      }
      if ((msg.kind === 'chat' || msg.kind === 'chat-sdk') && isStopCommand(msg)) {
        log('Stop command received — aborting active query if any');
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: 'Stopped.' }),
        });
        commandIds.push(msg.id);
        continue;
      }
      if ((msg.kind === 'chat' || msg.kind === 'chat-sdk') && isUploadTraceCommand(msg)) {
        log('Uploading session trace to Hugging Face');
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: uploadTrace() }),
        });
        commandIds.push(msg.id);
        continue;
      }
      normalMessages.push(msg);
    }

    if (commandIds.length > 0) {
      markCompleted(commandIds);
    }

    if (normalMessages.length === 0) {
      const remainingIds = ids.filter((id) => !commandIds.includes(id));
      if (remainingIds.length > 0) markCompleted(remainingIds);
      log(`All ${messages.length} message(s) were commands, skipping query`);
      continue;
    }

    // Pre-task scripts: for any task rows with a `script`, run it before the
    // provider call. Scripts returning wakeAgent=false (or erroring) gate
    // their own task row only — surviving messages still go to the agent.
    // Without the scheduling module, the marker block is empty, `keep`
    // falls back to `normalMessages`, and no gating happens.
    let keep: MessageInRow[] = normalMessages;
    let skipped: string[] = [];
    // MODULE-HOOK:scheduling-pre-task:start
    const { applyPreTaskScripts } = await import('./scheduling/task-script.js');
    const preTask = await applyPreTaskScripts(normalMessages);
    keep = preTask.keep;
    skipped = preTask.skipped;
    if (skipped.length > 0) {
      markCompleted(skipped);
      log(`Pre-task script skipped ${skipped.length} task(s): ${skipped.join(', ')}`);
    }
    // MODULE-HOOK:scheduling-pre-task:end

    if (keep.length === 0) {
      log(`All ${normalMessages.length} non-command message(s) gated by script, skipping query`);
      continue;
    }

    // Format messages: passthrough commands get raw text (only if the
    // provider natively handles slash commands), others get XML.
    const prompt = formatMessagesWithCommands(keep, config.provider.supportsNativeSlashCommands);
    const attachments = extractImageAttachments(keep);

    log(`Processing ${keep.length} message(s), kinds: ${[...new Set(keep.map((m) => m.kind))].join(',')}`);

    const query = config.provider.query({
      prompt,
      continuation,
      cwd: config.cwd,
      systemContext: config.systemContext,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    // Process the query while concurrently polling for new messages
    const skippedSet = new Set(skipped);
    const processingIds = ids.filter((id) => !commandIds.includes(id) && !skippedSet.has(id));
    // Publish the batch's in_reply_to so MCP tools (send_message, send_file)
    // can stamp it on outbound rows — needed for a2a return-path routing.
    setCurrentInReplyTo(routing.inReplyTo);
    try {
      // This query is a cold resume only if it carries a resumed continuation
      // AND no prior query has run in this container. Capture before the call;
      // the flag is consumed by the grace window + resume-wedge strike inside.
      const isColdResume = coldResumePending && continuation !== undefined;
      const result = await processQuery(
        query,
        routing,
        processingIds,
        config.providerName,
        config.provider.onExchangeComplete?.bind(config.provider),
        prompt,
        continuation,
        // Explicit production defaults so the trailing test-only seams
        // (isColdResume + resumeGraceMs, driving the resume-grace window and
        // the resume-wedge strike) land past them.
        HEARTBEAT_WATCHDOG_MS,
        (code) => process.exit(code),
        getInFlightTool,
        touchHeartbeat,
        defaultOnWedge,
        isColdResume,
        RESUME_GRACE_MS,
      );
      // A returned query means the cold reload (if any) is done — every later
      // turn in this container is warm. A wedge exits before reaching here, so
      // a crash-looping cold resume never clears this and keeps striking.
      coldResumePending = false;
      // A turn that returned at all (wedged turns never do — they exit 76 first)
      // proves the SILENT resume healthy: drop the silent wedge counter so two
      // unrelated silent wedges far apart don't accumulate toward a false clear.
      // The post-init counter is left to its own wall-clock decay — a healthy
      // turn doesn't prove the post-init cluster history stale.
      resetWedgeStrikes(config.providerName);
      if (result.continuation && result.continuation !== continuation) {
        continuation = result.continuation;
        setContinuation(config.providerName, continuation);
      }
      // API error in result text: the gateway returned an error (e.g. budget
      // exceeded) that the SDK surfaced as a result string. Clear the
      // continuation so the next wakeup doesn't resume the same poisoned
      // session and hit the wall again.
      if (result.apiError && continuation) {
        log(`Clearing session after API error (${continuation}) — ${result.apiError.slice(0, 200)}`);
        continuation = undefined;
        clearContinuation(config.providerName);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Query error: ${errMsg}`);

      // If the SDK subprocess was SIGKILL'd (OOM or manual kill), Bun is still
      // alive but claude.exe is gone. The poll loop would keep running with a
      // dead executor. Exit so the host respawns a fresh container.
      if (isOomKill(err)) {
        log(`SDK subprocess SIGKILLed (OOM or kill) — exiting (137) for host respawn`);
        process.exit(137);
      }

      // Stale/corrupt continuation recovery: ask the provider whether
      // this error means the stored continuation is unusable, and clear
      // it so the next attempt starts fresh.
      if (continuation && config.provider.isSessionInvalid(err)) {
        log(`Stale session detected (${continuation}) — clearing for next retry`);
        continuation = undefined;
        clearContinuation(config.providerName);
      }

      // Write error response so the user knows something went wrong
      writeMessageOut({
        id: generateId(),
        kind: 'chat',
        platform_id: routing.platformId,
        channel_type: routing.channelType,
        thread_id: routing.threadId,
        content: JSON.stringify({ text: `Error: ${errMsg}` }),
      });
    } finally {
      clearCurrentInReplyTo();
    }

    // Ensure completed even if processQuery ended without a result event
    // (e.g. stream closed unexpectedly).
    markCompleted(processingIds);
    log(`Completed ${ids.length} message(s)`);
  }
}

/**
 * Format messages, handling passthrough commands differently.
 * When the provider handles slash commands natively (Claude Code),
 * passthrough commands are sent raw (no XML wrapping) so the SDK can
 * dispatch them. Otherwise they fall through to standard XML formatting.
 */
/**
 * Extract image attachments from a batch of messages so vision-capable
 * providers can forward them to the model alongside the text prompt.
 * Only `image/*` MIME types are included; other file types are skipped.
 * Files that have no `localPath` (e.g. text messages) are silently ignored.
 *
 * Exported for unit testing.
 */
export function extractImageAttachments(messages: MessageInRow[]): AttachmentRef[] {
  const result: AttachmentRef[] = [];
  for (const msg of messages) {
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(msg.content) as Record<string, unknown>;
    } catch {
      continue;
    }
    const atts = content.attachments as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(atts)) continue;
    for (const att of atts) {
      if (typeof att.localPath === 'string' && typeof att.mimeType === 'string' && att.mimeType.startsWith('image/')) {
        result.push({
          localPath: att.localPath,
          mimeType: att.mimeType,
          name: typeof att.name === 'string' ? att.name : undefined,
        });
      }
    }
  }
  return result;
}

function formatMessagesWithCommands(messages: MessageInRow[], nativeSlashCommands: boolean): string {
  const parts: string[] = [];
  const normalBatch: MessageInRow[] = [];

  for (const msg of messages) {
    if (nativeSlashCommands && (msg.kind === 'chat' || msg.kind === 'chat-sdk')) {
      const cmdInfo = categorizeMessage(msg);
      if (cmdInfo.category === 'passthrough' || cmdInfo.category === 'admin') {
        // Flush normal batch first
        if (normalBatch.length > 0) {
          parts.push(formatMessages(normalBatch));
          normalBatch.length = 0;
        }
        // Pass raw command text (no XML wrapping) — SDK handles it natively
        parts.push(cmdInfo.text);
        continue;
      }
    }
    normalBatch.push(msg);
  }

  if (normalBatch.length > 0) {
    parts.push(formatMessages(normalBatch));
  }

  return parts.join('\n\n');
}

interface QueryResult {
  continuation?: string;
  /** Gateway error text surfaced as a result (e.g. "API Error: …budget_exceeded"). */
  apiError?: string;
}

/**
 * Effective heartbeat-silence tolerance for the current moment. The window
 * tracks what the heartbeat ticker is doing, so the container self-kills on
 * the same bound the host would use rather than diverging from it:
 *
 *   - No tool in flight -> base window. A silent turn with no tool running is
 *     genuinely wedged (blocked LLM socket, dead SDK) and should be reaped
 *     fast; the ticker isn't touching the heartbeat either, so the host agrees.
 *   - Bash with a declared timeout -> `declaredTimeout + margin`. A long
 *     blocking `git clone`/`cargo build` emits no SDK events for its whole run.
 *   - Any other in-flight tool (default-timeout Bash, slow MCP call) -> the
 *     in-flight ceiling. The ticker keeps the heartbeat fresh for any in-flight
 *     tool, so the host treats it as alive up to its absolute ceiling; the
 *     container must match that bound or it self-exits(76) mid-tool at the 120s
 *     base while the host still believes it healthy.
 *   - No tool in flight, but the turn resumed a continuation and no SDK event
 *     has arrived yet (`resumeGraceMs > 0`) -> the resume-grace window. A cold
 *     reload of a large `.jsonl` on a busy gateway emits no events and runs no
 *     tool, so the bare base would false-fire; grant the resume-grace allowance
 *     until the first event lands. In-flight-tool widening takes precedence —
 *     once a tool is running the reload is demonstrably done.
 */
export function effectiveWatchdogMs(
  baseMs: number,
  inFlight: InFlightTool | null,
  resumeGraceMs = 0,
): number {
  // resumeGraceMs is always >= 0 (0 = no grace), so Math.max alone covers both.
  if (!inFlight) return Math.max(baseMs, resumeGraceMs);
  if (inFlight.tool === 'Bash' && typeof inFlight.declaredTimeoutMs === 'number') {
    return Math.max(baseMs, inFlight.declaredTimeoutMs + WATCHDOG_BASH_MARGIN_MS);
  }
  return Math.max(baseMs, IN_FLIGHT_CEILING_MS);
}

/**
 * Strike-count-then-maybe-clear behavior for a watchdog-76 wedge. Bumps a
 * per-continuation counter; once it hits its path's limit, clears the poisoned
 * continuation (which also resets both counters) so the host's next respawn
 * starts a fresh session instead of resuming the same wall.
 *
 * Two paths, chosen by `postInit` (whether `init` fired before the hang):
 *   - SILENT (no init) -> fast heal at WEDGE_STRIKE_LIMIT (2).
 *   - POST-INIT (init fired, then hung) -> higher, time-decayed budget so an
 *     isolated transient gateway stall never clears a healthy continuation
 *     while clustered respawns (real poison) still self-heal.
 */
function applyWedgeStrike(
  provider: string,
  continuation: string,
  strikes: number,
  limit: number,
  phase: 'silent' | 'post-init',
): void {
  if (strikes >= limit) {
    log(
      `Watchdog wedge strike ${strikes}/${limit} (${phase}) on ${continuation} — clearing poisoned continuation before respawn`,
    );
    clearContinuation(provider); // wipes both counters
  } else {
    log(`Watchdog wedge strike ${strikes}/${limit} (${phase}) on ${continuation} — keeping continuation`);
  }
}

function defaultOnWedge(provider: string, continuation: string, postInit: boolean): void {
  const { strikes, limit, phase } = postInit
    ? {
        strikes: bumpPostInitWedgeStrikes(provider, POST_INIT_WEDGE_DECAY_MS),
        limit: POST_INIT_WEDGE_STRIKE_LIMIT,
        phase: 'post-init' as const,
      }
    : {
        strikes: bumpWedgeStrikes(provider),
        limit: WEDGE_STRIKE_LIMIT,
        phase: 'silent' as const,
      };
  applyWedgeStrike(provider, continuation, strikes, limit, phase);
}

export async function processQuery(
  query: AgentQuery,
  routing: RoutingContext,
  initialBatchIds: string[],
  providerName: string,
  onExchangeComplete: ((exchange: ProviderExchange) => void) | undefined,
  initialPrompt: string,
  initialContinuation: string | undefined,
  // Injectable for tests; production uses the module constant + process.exit.
  watchdogMs: number = HEARTBEAT_WATCHDOG_MS,
  exitProcess: (code: number) => void = (code) => process.exit(code),
  // Injectable for tests; production reads the in-process in-flight tool state
  // maintained by the pre/post-tool hooks (providers/claude.ts).
  getInFlight: () => InFlightTool | null = getInFlightTool,
  // Injectable for tests; production touches the real heartbeat file.
  touch: () => void = touchHeartbeat,
  // Injectable for tests; production bumps the per-continuation wedge-strike
  // counter and clears the poisoned continuation once it hits the limit.
  onWedge: (provider: string, continuation: string, postInit: boolean) => void = defaultOnWedge,
  // True only on the container's FIRST query that carries a resumed
  // continuation — a genuine cold `.jsonl` reload after a host respawn /
  // idle-kill. Every later warm turn passes false: the transcript is already
  // loaded in the live SDK subprocess, so there is no disk reload to wait on
  // and a pre-init stall there is a real wedge, not a slow load. Gates BOTH the
  // resume-grace window (pre-init only) and whether a wedge strikes the
  // continuation. On a warm turn a wedge never strikes — it's a fresh-turn
  // transient, not resume poisoning. The resumed id is `initialContinuation`.
  isColdResume = false,
  // Injectable for tests; production uses the module constant. The extra window
  // granted to the pre-first-event phase of a cold resume so a slow reload is
  // not mistaken for a wedge. Applied only while isColdResume and no event has
  // landed.
  resumeGraceMs: number = RESUME_GRACE_MS,
): Promise<QueryResult> {
  let queryContinuation: string | undefined;
  let done = false;
  let unwrappedNudged = false;
  // Whether any SDK event has arrived this turn. Ends the resume-grace window:
  // once the first event lands the cold `.jsonl` reload is demonstrably done, so
  // the deadline falls back to the base/in-flight window. (The wedge strike keys
  // off isColdResume, not this — a cold resume strikes silent OR post-init.)
  let firstEventSeen = false;
  // Heartbeat-silence watchdog: armed for the duration of this turn. The
  // deadline is `lastEventAt + effectiveWatchdogMs`, where the effective window
  // is the base watchdogMs normally, but widens to a declared Bash timeout (+
  // margin) while such a tool is in flight — a long blocking shell command
  // emits no SDK events for its whole run, so without this it looks identical to
  // a genuinely wedged turn. When the timer fires we re-derive the deadline
  // against the *current* in-flight state: if it hasn't elapsed yet (a long Bash
  // is legitimately running) we reschedule for the remainder; otherwise the
  // turn is wedged — self-exit(76) so the host respawns with messages reset to
  // pending. Cause-independent: doesn't care whether the stall is in the LLM
  // socket, the MCP pipe, or the SDK.
  let lastEventAt = Date.now();
  // One timer for the whole turn, re-armed via refresh() (zero-alloc) rather
  // than reallocated per event. The timer always wakes at the base interval;
  // fireWatchdog re-derives the *real* deadline against lastEventAt and the
  // current in-flight tool when it trips, so an early wake (e.g. mid long Bash)
  // simply refreshes and rechecks rather than killing a healthy turn.
  const watchdog = setTimeout(fireWatchdog, watchdogMs);
  function fireWatchdog(): void {
    if (done) return;
    // Resume-grace applies only in the pre-first-event phase of a COLD resume —
    // the one turn that reloads a large `.jsonl` from disk. It runs no tool, so
    // without the grace the bare base would judge a slow-but-healthy reload as a
    // wedge. A warm turn (transcript already loaded) gets no grace: a pre-init
    // stall there is a genuine wedge and deserves the bare base.
    const graceMs = isColdResume && !firstEventSeen ? resumeGraceMs : 0;
    const effectiveMs = effectiveWatchdogMs(watchdogMs, getInFlight(), graceMs);
    const silenceMs = Date.now() - lastEventAt;
    if (silenceMs < effectiveMs) {
      // Still inside the allowed window (a long-declared Bash / in-flight tool
      // is legitimately running) — re-arm and recheck rather than killing it.
      watchdog.refresh();
      return;
    }
    log(
      `Heartbeat-silence watchdog: no SDK event in ${silenceMs}ms (limit ${effectiveMs}ms) during active turn — exiting (76) for host respawn`,
    );
    done = true;
    clearInterval(pollHandle);
    clearTimeout(watchdog);
    // The turn wedged before processQuery could return, so the graceful
    // apiError clear path never runs. Strike the continuation only when a COLD
    // resume wedges — silent OR post-init. On the cold path a repeatedly-wedging
    // resume is exactly resume poison, and `init` firing proves only the resume
    // *mechanism* (transcript loaded), not the continuation's downstream state,
    // so a post-init cold wedge is still plausibly poison and must accrue
    // strikes to self-heal. `firstEventSeen` picks the path in defaultOnWedge:
    // silent -> fast limit-2 heal; post-init -> higher, time-decayed budget so
    // an isolated transient gateway stall never clears a healthy continuation
    // while clustered respawns still self-heal. A WARM turn's wedge never
    // strikes: it's a fresh-turn transient (hung socket mid-conversation), not
    // resume poisoning, and clearing there would wipe a good thread's memory.
    // Cold-resume reload slowness itself never reaches here — the grace above
    // widens the pre-init window well past a legitimate reload. Non-striking
    // cases still exit-76; the host respawns with messages reset to pending.
    if (isColdResume && initialContinuation !== undefined) {
      onWedge(providerName, initialContinuation, firstEventSeen);
    }
    // Defer exit one tick so this log line flushes through Docker's log driver.
    setTimeout(() => exitProcess(76), 100);
  }
  // Prompt queue for the exchange hook — each result event consumes the
  // oldest unanswered prompt, except a wrapping-retry result, which answers
  // the same prompt again. Unused (and unmaintained) when the provider
  // doesn't implement `onExchangeComplete`.
  const archivePrompts: string[] = [initialPrompt];
  // OpenCode-only completion gate (see db/final-signal.ts): a turn only
  // counts as done once send_message(final:true) or end_turn fired since
  // this baseline. Snapshotted fresh before each turn, advanced after each
  // result event so the NEXT turn's window only covers signals raised
  // during that turn.
  let finalSignalBaseline = getFinalSignalCount();
  let finalSignalNudges = 0;
  const MAX_FINAL_SIGNAL_NUDGES = 2;

  // Concurrent polling: push follow-ups into the active query as they arrive.
  // We do NOT force-end the stream on silence — keeping the query open avoids
  // re-spawning the SDK subprocess (~few seconds) and re-loading the .jsonl
  // transcript on every turn. The Anthropic prompt cache is server-side with
  // a 5-min TTL keyed on prefix hash, so stream lifecycle does NOT affect
  // cache lifetime — close+reopen within 5 min still gets cache hits.
  // Stream liveness is decided host-side via the heartbeat file + processing
  // claim age (see src/host-sweep.ts); if something is truly stuck, the host
  // will kill the container and messages get reset to pending.
  let pollInFlight = false;
  let endedForCommand = false;
  let corruptionStreak = 0;
  const pollHandle = setInterval(() => {
    // Keep the heartbeat fresh while a query is in flight, even when the SDK
    // emits no events — a single blocking Bash freezes the query.events loop
    // for its whole duration, and a long top-level thinking/response pass with
    // no tool in flight is equally event-silent. This decouples the host's
    // liveness view from SDK-event cadence so neither reads as wedged to the
    // host's stale-heartbeat kill paths. The ticker feeds only the host's
    // heartbeat — it never calls watchdog.refresh(), so the exit-76 watchdog
    // stays the in-container reaper for an *async-stalled* wedged turn (a hung
    // socket while the event loop is alive). A turn that synchronously blocks
    // the event loop freezes both this ticker and the watchdog's setTimeout, so
    // the heartbeat goes stale and the host's reaper catches it instead.
    if (!done) touch();
    if (done || pollInFlight || endedForCommand) return;
    pollInFlight = true;

    void (async () => {
      try {
        const pending = getPendingMessages();

        // Slash commands need a fresh query: /clear resets the SDK's
        // resume id (fixed at sdkQuery() time); admin/passthrough commands
        // (/compact, /cost, …) only dispatch when they're the first input
        // of a query — pushed mid-stream they arrive as plain text and
        // the SDK never runs them. Abort the active stream and leave the
        // rows pending; the outer loop handles them on next iteration via
        // the canonical command path + formatMessagesWithCommands. Abort,
        // not end: end() lets an in-flight turn run to completion, which
        // can block the command (e.g. /clear during a long task) for as
        // long as the turn takes.
        if (pending.some((m) => isRunnerCommand(m))) {
          log('Pending slash command — aborting active stream so outer loop can process');
          endedForCommand = true;
          query.abort();
          return;
        }

        // Skip system messages (MCP tool responses).
        // Thread routing is the router's concern — if a message landed in this
        // session, the agent should see it. Per-thread sessions already isolate
        // threads into separate containers; shared sessions intentionally merge
        // everything. Filtering on thread_id here caused deadlocks when the
        // initial batch and follow-ups had mismatched thread_ids (e.g. a
        // host-generated welcome trigger with null thread vs a Discord DM reply).
        const newMessages = pending.filter((m) => m.kind !== 'system');
        if (newMessages.length === 0) return;

        const newIds = newMessages.map((m) => m.id);
        markProcessing(newIds);

        // Run pre-task scripts on follow-ups too — without this, a task that
        // arrives during an active query (e.g. a */10 monitoring cron) bypasses
        // its script gate and always wakes the agent, defeating the gate.
        // Mirrors the initial-batch hook above.
        let keep = newMessages;
        let skipped: string[] = [];
        // MODULE-HOOK:scheduling-pre-task-followup:start
        const { applyPreTaskScripts } = await import('./scheduling/task-script.js');
        const preTask = await applyPreTaskScripts(newMessages);
        keep = preTask.keep;
        skipped = preTask.skipped;
        if (skipped.length > 0) {
          markCompleted(skipped);
          log(`Pre-task script skipped ${skipped.length} follow-up task(s): ${skipped.join(', ')}`);
        }
        // MODULE-HOOK:scheduling-pre-task-followup:end

        if (keep.length === 0) return;
        // Re-check done — the outer query may have finished while the script
        // was awaited. Pushing into a closed stream is wasted work; the
        // claimed messages get released by the host's processing-claim sweep.
        if (done) return;

        const keptIds = keep.map((m) => m.id);
        const followUpPrompt = formatMessages(keep);
        const followUpAttachments = extractImageAttachments(keep);
        log(`Pushing ${keep.length} follow-up message(s) into active query`);
        unwrappedNudged = false;
        finalSignalNudges = 0; // fresh turn — give it its own completion-nudge budget
        query.push(followUpPrompt, followUpAttachments.length > 0 ? followUpAttachments : undefined);
        archivePrompts.push(followUpPrompt);
        markCompleted(keptIds);
      } catch (err) {
        // Without this catch the rejection escapes the void IIFE and Node
        // terminates the container on unhandled-rejection. The initial-batch
        // path is wrapped by processQuery's outer try/catch; the follow-up
        // path is not, so it needs its own.
        const errMsg = err instanceof Error ? err.message : String(err);
        log(`Follow-up poll error: ${errMsg}`);

        // Detect SQLite cross-mount corruption (Docker Desktop macOS virtiofs /
        // gRPC-FUSE coherency bug — the kernel page cache for the inbound.db
        // bind mount can latch a torn snapshot mid-host-write, after which
        // every fresh openInboundDb() in this process sees the same broken
        // view. Reopening inside the container does NOT recover; only a fresh
        // container mount does. Exit so the host sweep respawns us.
        if (isCorruptionError(errMsg)) {
          corruptionStreak += 1;
          if (corruptionStreak >= CORRUPTION_STREAK_EXIT) {
            log(
              `Follow-up poll: ${corruptionStreak} consecutive '${errMsg}' errors — ` +
                `inbound.db page cache is poisoned. Exiting so host respawns with a fresh mount.`,
            );
            // Stop touching the heartbeat so host-sweep stale detection fires
            // promptly even if exit() races with in-flight async work.
            done = true;
            clearInterval(pollHandle);
            // Defer exit one tick so this log line flushes through Docker's
            // log driver before the process dies.
            setTimeout(() => process.exit(75), 100);
          }
        } else {
          corruptionStreak = 0;
        }
      } finally {
        pollInFlight = false;
      }
    })();
  }, ACTIVE_POLL_INTERVAL_MS);

  try {
    for await (const event of query.events) {
      handleEvent(event, routing);
      touch();
      // The first event of the turn ends the resume-grace phase and proves the
      // resume MECHANISM healthy (transcript loaded) — from here the base/in-flight
      // windows govern. It also flips a later cold-resume wedge from the silent
      // path to the post-init decayed-budget path (a post-init hang still strikes,
      // just against the higher, time-decaying limit).
      firstEventSeen = true;
      // Every SDK event pushes the watchdog deadline out. Stamp the event time
      // and refresh the existing timer (zero-alloc) for a full base window;
      // fireWatchdog re-derives the real deadline against the in-flight tool
      // when it actually trips.
      lastEventAt = Date.now();
      watchdog.refresh();

      if (event.type === 'init') {
        queryContinuation = event.continuation;
        // Persist immediately so a mid-turn container crash still lets the
        // next wake resume the conversation. Without this, the session id
        // was only written after the full stream completed — if the
        // container died between `init` and `result`, the SDK session was
        // effectively orphaned and the next message started a blank
        // Claude session with no prior context.
        setContinuation(providerName, event.continuation);
      } else if (event.type === 'result') {
        // A result — with or without text — means the turn is done. Mark
        // the initial batch completed now so the host sweep doesn't see
        // stale 'processing' claims while the query stays open for
        // follow-up pushes. The agent may have responded via MCP
        // (send_message) mid-turn, or the message may not need a response
        // at all — either way the turn is finished.
        markCompleted(initialBatchIds);

        // Detect gateway/SDK errors surfaced as result text (e.g. budget_exceeded).
        // These are not agent responses — nudging the SDK just loops until killed,
        // and (for OpenCode) the final-signal gate would spin forever on a dead
        // turn. Abort the query, deliver the error text to the user, and signal
        // the caller to clear the continuation so the next wakeup doesn't resume
        // the same poisoned session.
        if (event.text && API_ERROR_RE.test(event.text)) {
          log(`API error in result text — aborting query: ${event.text.slice(0, 200)}`);
          writeMessageOut({
            id: generateId(),
            kind: 'chat',
            platform_id: routing.platformId,
            channel_type: routing.channelType,
            thread_id: routing.threadId,
            content: JSON.stringify({ text: `Error: ${event.text}` }),
          });
          query.abort();
          return { continuation: queryContinuation, apiError: event.text };
        }

        if (providerName === 'opencode') {
          // Authoritative, structural completion gate: a turn only counts as
          // done once send_message(final:true) or end_turn fired since the
          // baseline (see db/final-signal.ts). This replaces inferring
          // completion from text shape (trailing scratchpad, DONE sentinels,
          // echo-matching against outbound.db) — those heuristics let a model
          // announce "I will now do X" via a plain send_message call and have
          // the turn counted delivered/complete even though no further work
          // ever happened. dispatchResultText() still runs (below) purely to
          // log the scratchpad — opencode never uses the <message> protocol,
          // so its `sent`/`hasUnwrapped` fields are meaningless here.
          if (event.text) dispatchResultText(event.text, routing);

          const currentSignal = getFinalSignalCount();
          const sawFinalSignal = currentSignal > finalSignalBaseline;
          finalSignalBaseline = currentSignal;

          notifyExchangeComplete(onExchangeComplete, {
            prompt: archivePrompts[0] ?? initialPrompt,
            result: event.text,
            continuation: queryContinuation ?? initialContinuation,
            status: sawFinalSignal ? 'completed' : 'undelivered',
          });

          if (sawFinalSignal) {
            finalSignalNudges = 0;
            archivePrompts.shift();
          } else if (finalSignalNudges < MAX_FINAL_SIGNAL_NUDGES) {
            finalSignalNudges += 1;
            const destinations = getAllDestinations();
            const names = destinations.map((d) => d.name).join(', ');
            query.push(
              `<system>You did not call a tool to end this turn. This MUST be an actual MCP tool call — ` +
                `not text output. Writing "final", "done", "<finish/>", or any other word or tag in your ` +
                `response text does NOT close the turn; only a real tool invocation does, and none was made. ` +
                `Whatever you just wrote as plain text was never seen by the user and is gone now — it does ` +
                `not count as sent and cannot be referenced as "already said above". If you have something to ` +
                `tell the user, call the send_message tool with final: true and pass your FULL intended answer ` +
                `as the text argument — not a shortened stand-in written just to close this turn. The text you ` +
                `pass is the only thing that reaches the user. If you have nothing further to send but are ` +
                `finished, call the end_turn tool (no arguments). If you are not actually done, keep working ` +
                `with more tool calls first. Your destinations: ${names}.</system>`,
            );
            // Keep archivePrompts[0] queued — the retry answers the same prompt.
          } else {
            // Hard ceiling: guarantee closure no matter what the model does.
            // Without this a model that never learns the contract would leave
            // the user waiting forever instead of getting an honest stop.
            deliverErrorResult(
              "_I wasn't able to reach a clear stopping point for this and I'm stopping here. " +
                'Please resend if you would like me to keep going._',
              routing,
            );
            archivePrompts.shift();
            finalSignalNudges = 0;
          }
        } else if (event.text) {
          const { sent, hasUnwrapped } = dispatchResultText(event.text, routing);
          if (sent === 0 && event.isError === true) {
            // Non-retryable error turn (e.g. a 403 billing_error) with no
            // <message> envelope: deliver the notice instead of dropping it as
            // scratchpad, and skip the re-wrap nudge — it would just re-hammer
            // the failing gateway turn after turn.
            deliverErrorResult(event.text, routing);
            notifyExchangeComplete(onExchangeComplete, {
              prompt: archivePrompts[0] ?? initialPrompt,
              result: event.text,
              continuation: queryContinuation ?? initialContinuation,
              status: 'error',
            });
            archivePrompts.shift();
          } else {
            const willRetryWrapping = hasUnwrapped && !unwrappedNudged;
            notifyExchangeComplete(onExchangeComplete, {
              prompt: archivePrompts[0] ?? initialPrompt,
              result: event.text,
              continuation: queryContinuation ?? initialContinuation,
              status: hasUnwrapped ? 'undelivered' : 'completed',
            });
            if (willRetryWrapping) {
              unwrappedNudged = true;
              const destinations = getAllDestinations();
              const names = destinations.map((d) => d.name).join(', ');
              const nudgeText =
                `<system>Your response was not delivered — it was not wrapped in <message to="name">...</message> blocks. ` +
                `All output must be wrapped: use <message to="name"> for content to send, or <internal> for scratchpad. ` +
                `If you genuinely cannot complete the request (missing tool, missing access, etc.), that IS your ` +
                `complete answer — wrap a plain statement of what you can't do and why, instead of promising to do it. ` +
                `Your destinations: ${names}. ` +
                `Please re-send your response with the correct wrapping.</system>`;
              query.push(nudgeText);
            }
            // The wrapping-retry result answers the SAME user prompt — keep it
            // queued so the retry archives against it, not the nudge text.
            if (!willRetryWrapping) archivePrompts.shift();
            // Fix 2: after exhausting the one wrapping-retry, the message would
            // be silently dropped and the user left with no feedback. Deliver a
            // notice so they know to resend rather than waiting indefinitely.
            if (hasUnwrapped && !willRetryWrapping) {
              deliverErrorResult(
                "_My response couldn't be delivered due to a formatting error. Please resend your message._",
                routing,
              );
            }
          }
        } else {
          archivePrompts.shift();
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    notifyExchangeComplete(onExchangeComplete, {
      prompt: archivePrompts[0] ?? initialPrompt,
      result: `Error: ${errMsg}`,
      continuation: queryContinuation ?? initialContinuation,
      status: 'error',
    });
    throw err;
  } finally {
    done = true;
    clearInterval(pollHandle);
    clearTimeout(watchdog);
  }

  return { continuation: queryContinuation };
}

function notifyExchangeComplete(
  hook: ((exchange: ProviderExchange) => void) | undefined,
  exchange: ProviderExchange,
): void {
  if (!hook) return;
  try {
    hook(exchange);
  } catch (err) {
    log(`onExchangeComplete failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function handleEvent(event: ProviderEvent, _routing: RoutingContext): void {
  switch (event.type) {
    case 'init':
      log(`Session: ${event.continuation}`);
      break;
    case 'result':
      log(`Result: ${event.text ? event.text.slice(0, 200) : '(empty)'}`);
      break;
    case 'error':
      log(
        `Error: ${event.message} (retryable: ${event.retryable}${event.classification ? `, ${event.classification}` : ''})`,
      );
      break;
    case 'progress':
      log(`Progress: ${event.message}`);
      break;
  }
}

/**
 * Deliver a turn's text straight to the channel the batch arrived on. Used when
 * a turn ends in a provider error (e.g. a non-retryable 403 billing_error) with
 * no <message> envelope: the notice would otherwise be dropped as scratchpad.
 * This is the same user-facing write the outer catch block does, minus the
 * `Error:` prefix — the provider's text is already a user-facing message.
 */
function deliverErrorResult(text: string, routing: RoutingContext): void {
  log('Error result with no <message> envelope — delivering to channel');
  writeMessageOut({
    id: generateId(),
    in_reply_to: routing.inReplyTo,
    kind: 'chat',
    platform_id: routing.platformId,
    channel_type: routing.channelType,
    thread_id: routing.threadId,
    content: JSON.stringify({ text }),
  });
}

/**
 * Parse the agent's final text for <message to="name">...</message> blocks
 * and dispatch each one to its resolved destination. Text outside of blocks
 * (including <internal>...</internal>) is scratchpad — logged but not sent.
 *
 * The agent must always wrap output in <message to="name">...</message>
 * blocks, even with a single destination. Bare text is scratchpad only.
 */
function dispatchResultText(text: string, routing: RoutingContext): { sent: number; hasUnwrapped: boolean } {
  const MESSAGE_RE = /<message\s+to="([^"]+)"\s*>([\s\S]*?)<\/message>/g;

  let match: RegExpExecArray | null;
  let sent = 0;
  let lastIndex = 0;
  const scratchpadParts: string[] = [];

  while ((match = MESSAGE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      scratchpadParts.push(text.slice(lastIndex, match.index));
    }
    const toName = match[1];
    const body = match[2].trim();
    lastIndex = MESSAGE_RE.lastIndex;

    const dest = findByName(toName);
    if (!dest) {
      log(`Unknown destination in <message to="${toName}">, dropping block`);
      scratchpadParts.push(`[dropped: unknown destination "${toName}"] ${body}`);
      continue;
    }
    sendToDestination(dest, body, routing);
    sent++;
  }
  if (lastIndex < text.length) {
    scratchpadParts.push(text.slice(lastIndex));
  }

  const scratchpad = stripInternalTags(scratchpadParts.join(''));

  if (scratchpad) {
    log(`[scratchpad] ${scratchpad.slice(0, 500)}${scratchpad.length > 500 ? '…' : ''}`);
  }

  // Fix 1: fallback for unclosed <message to="name"> blocks.
  // Models like DeepSeek V4 Flash frequently omit the closing </message> tag on
  // long responses, causing the regex above to find no matches even though the
  // entire response is a valid (but unclosed) message block. Detect this case:
  // if nothing was matched AND the full text (after stripping internal tags)
  // starts with an opening <message to="..."> tag, treat everything after the
  // opening tag as the message body and deliver it rather than discarding it.
  if (sent === 0 && scratchpad) {
    const UNCLOSED_RE = /^<message\s+to="([^"]+)"\s*>([\s\S]*)$/;
    const uc = stripInternalTags(text.trim()).match(UNCLOSED_RE);
    if (uc) {
      const dest = findByName(uc[1]);
      if (dest) {
        const body = uc[2].trim();
        log(`WARNING: <message to="${uc[1]}"> was missing closing tag — delivering anyway`);
        sendToDestination(dest, body, routing);
        sent++;
      }
    }
  }

  const hasUnwrapped = sent === 0 && !!scratchpad;
  if (hasUnwrapped) {
    log(`WARNING: agent output had no <message to="..."> blocks — nothing was sent`);
  }
  return { sent, hasUnwrapped };
}

function sendToDestination(dest: DestinationEntry, body: string, routing: RoutingContext): void {
  const platformId = dest.type === 'channel' ? dest.platformId! : dest.agentGroupId!;
  const channelType = dest.type === 'channel' ? dest.channelType! : 'agent';
  const sameChannel = routing.channelType === channelType && routing.platformId === platformId;
  const threadId = sameChannel
    ? routing.threadId
    : (resolveDestinationThread(channelType, platformId)?.threadId ?? null);
  writeMessageOut({
    id: generateId(),
    in_reply_to: routing.inReplyTo,
    kind: 'chat',
    platform_id: platformId,
    channel_type: channelType,
    thread_id: threadId,
    content: JSON.stringify({ text: body }),
  });
}

/**
 * Find the thread_id and message id from the most recent inbound message
 * matching the given channel+platform. Returns null if no match found.
 */
function resolveDestinationThread(
  channelType: string,
  platformId: string,
): { threadId: string | null; inReplyTo: string | null } | null {
  try {
    const db = getInboundDb();
    const row = db
      .prepare(
        `SELECT thread_id, id FROM messages_in
         WHERE channel_type = ? AND platform_id = ?
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(channelType, platformId) as { thread_id: string | null; id: string } | undefined;
    if (row) return { threadId: row.thread_id, inReplyTo: row.id };
  } catch (err) {
    log(`resolveDestinationThread error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
