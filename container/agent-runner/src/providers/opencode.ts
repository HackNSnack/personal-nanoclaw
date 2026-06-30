import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';

import { registerProvider } from './provider-registry.js';
import type { AgentProvider, AgentQuery, AttachmentRef, ProviderEvent, ProviderOptions, QueryInput } from './types.js';
import { mcpServersToOpenCodeConfig } from './mcp-to-opencode.js';

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}][opencode-provider] ${msg}`);
}

function logDebug(msg: string): void {
  // Enabled by DEBUG=opencode-provider or DEBUG=* in container env
  const d = process.env.DEBUG || '';
  const parts = d.split(',').map((s) => s.trim());
  if (d === '*' || parts.includes('opencode-provider') || parts.includes('opencode')) {
    console.error(`[${new Date().toISOString()}][opencode-provider][debug] ${msg}`);
  }
}

const SESSION_STATUS_RETRY_ERROR_AFTER = 3;

/**
 * Grace period (ms) after session.idle during which we continue draining
 * message.part.updated events. DeepSeek V4 Flash (and similar models) emit
 * the final tokens — including the `</message>` closing tag — AFTER
 * session.idle fires due to an ordering race in OpenCode's SSE pipeline.
 * Configurable via OPENCODE_IDLE_DRAIN_WINDOW_MS.
 */
const IDLE_DRAIN_WINDOW_MS = Number(process.env.OPENCODE_IDLE_DRAIN_WINDOW_MS) || 400;

/** Stale / dead OpenCode session heuristics (complement Claude-centric host patterns). */
const STALE_SESSION_RE =
  /no conversation found|ENOENT.*\.jsonl|session.*not found|NotFoundError|connection reset|ECONNRESET|404|event timeout|model not found|ProviderModelNotFoundError/i;

// ── Retry configuration (env vars) ──

/** Master switch: enable retry on transient errors. Default true. Set OPENCODE_RETRY_ENABLED=false to disable. */
const RETRY_ENABLED = (process.env.OPENCODE_RETRY_ENABLED || 'true').toLowerCase() !== 'false';

/** Max retry attempts per turn on retryable errors. Env OPENCODE_RETRY_MAX_ATTEMPTS. */
const RETRY_MAX_ATTEMPTS = Number(process.env.OPENCODE_RETRY_MAX_ATTEMPTS) || 3;

/** Base backoff (ms), doubled each retry. Env OPENCODE_RETRY_BASE_DELAY_MS. */
const RETRY_BASE_DELAY_MS = Number(process.env.OPENCODE_RETRY_BASE_DELAY_MS) || 1000;

/** Max backoff (ms). Env OPENCODE_RETRY_MAX_DELAY_MS. */
const RETRY_MAX_DELAY_MS = Number(process.env.OPENCODE_RETRY_MAX_DELAY_MS) || 60_000;

/**
 * Classify an error as retryable (transient upstream/timeout) or permanent.
 * Exported for testing.
 */
export function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  // Non-retryable take precedence
  if (
    /4(?!28)0[0-9]/.test(msg) ||
    /rate limit|429|model not found|ProviderModelNotFoundError|InvalidRequestError|AuthenticationError|PermissionError/i.test(
      msg,
    )
  ) {
    return false;
  }
  return /50[0-9]|timeout|Upstream idle timeout|ETIMEDOUT|ECONNRESET|deadline exceeded|event timeout|temporarily unavailable/i.test(
    msg,
  );
}

/** Exported for testing. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff + jitter for retry delays.
 * attempt=2 returns base, 3=2x, etc. Clamped at maxMs.
 * Optional baseMs/maxMs params allow tests to pass fixed values without
 * touching module-level constants (which are read at load time).
 * Exported for testing.
 */
export function retryDelay(attempt: number, baseMs = RETRY_BASE_DELAY_MS, maxMs = RETRY_MAX_DELAY_MS): number {
  if (attempt <= 1) return 0;
  const exp = baseMs * 2 ** (attempt - 2);
  const clamped = Math.min(exp, maxMs);
  const jitter = clamped * 0.3 * Math.random();
  return Math.floor(clamped + jitter);
}

/**
 * Sleep implementation — injectable so tests can replace it with a no-op
 * and avoid real delays. Call _setSleepForTest(fn) in beforeEach.
 */
let _sleepFn: (ms: number) => Promise<void> = sleep;

/** Test hook: replace the sleep implementation (e.g. with a no-op). */
export function _setSleepForTest(fn: (ms: number) => Promise<void>): void {
  _sleepFn = fn;
}

/**
 * Read an image attachment off the session inbox and return its base64.
 * Injectable so tests can supply deterministic bytes without touching
 * /workspace on disk. `localPath` is relative to /workspace in the container.
 */
let _readImageBase64: (localPath: string) => string = (localPath) =>
  readFileSync(`/workspace/${localPath}`).toString('base64');

/** Test hook: replace the image reader (e.g. to return fixed bytes). */
export function _setImageReaderForTest(fn: ((localPath: string) => string) | null): void {
  _readImageBase64 = fn ?? ((localPath) => readFileSync(`/workspace/${localPath}`).toString('base64'));
}

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

function spawnOpencodeServer(
  config: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<{ url: string; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const hostname = '127.0.0.1';
    const port = 4096;
    const proc = spawn('opencode', ['serve', `--hostname=${hostname}`, `--port=${port}`], {
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
      detached: true,
    });

    const id = setTimeout(() => {
      killProcessTree(proc);
      reject(new Error(`Timeout waiting for OpenCode server to start after ${timeoutMs}ms`));
    }, timeoutMs);

    let output = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split('\n')) {
        if (line.startsWith('opencode server listening')) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(id);
            resolve({ url: match[1], proc });
          }
        }
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on('exit', (code) => {
      clearTimeout(id);
      let msg = `OpenCode server exited with code ${code}`;
      if (output.trim()) msg += `\nServer output: ${output}`;
      reject(new Error(msg));
    });
    proc.on('error', (err) => {
      clearTimeout(id);
      reject(err);
    });
  });
}

// NOTE: System instructions are NOT wrapped into the user turn here. OpenCode's
// promptAsync body has a dedicated `system` field (forwarded to the provider as
// a real system message). Earlier revisions embedded instructions as
// `<system>...</system>` XML inside the user text; DeepSeek tolerated that, but
// Mistral-family models echo the XML back verbatim instead of following it.
// See the `system:` field on the promptAsync call below.

/**
 * OpenCode model IDs must be fully-qualified as `provider_id/model_id`.
 * When using a non-anthropic provider (e.g. `openrouter`) users often set
 * OPENCODE_MODEL to just the model slug (e.g. `deepseek/deepseek-v4-pro`).
 * This helper prepends the provider prefix when it is missing so both
 * the short form and the full form work.
 */
function fullyQualifiedModel(provider: string, rawModel: string | undefined): string | undefined {
  if (!rawModel) return undefined;
  // Anthropic is the default provider in OpenCode — model IDs have no prefix.
  if (provider === 'anthropic') return rawModel;
  // Already prefixed — leave it alone.
  if (rawModel.startsWith(`${provider}/`)) return rawModel;
  return `${provider}/${rawModel}`;
}

/**
 * Strip the `provider/` prefix from a fully-qualified model ID to get
 * the bare model slug used as a key in `provider.<id>.models`.
 */
function modelSlug(provider: string, qualifiedModel: string | undefined): string | undefined {
  if (!qualifiedModel) return undefined;
  if (provider !== 'anthropic' && qualifiedModel.startsWith(`${provider}/`)) {
    return qualifiedModel.slice(provider.length + 1);
  }
  return qualifiedModel;
}

/**
 * Build the OpenCode server config from env + provider options. Exported for
 * unit testing (model declaration, vision modalities, OpenRouter routing).
 */
export function buildOpenCodeConfig(options: ProviderOptions): Record<string, unknown> {
  const provider = process.env.OPENCODE_PROVIDER || 'anthropic';
  const model = fullyQualifiedModel(provider, process.env.OPENCODE_MODEL);
  const smallModel = fullyQualifiedModel(provider, process.env.OPENCODE_SMALL_MODEL);
  const proxyUrl = process.env.ANTHROPIC_BASE_URL;

  // OpenCode's bundled model list (sourced from models.dev) is updated
  // infrequently — models newer than the OpenCode release will throw
  // ProviderModelNotFoundError at startup even if OpenRouter supports them.
  // Explicitly declaring models in provider.<id>.models bypasses the
  // bundled-list check entirely.
  // Parse optional OpenRouter provider routing config (from OPENCODE_OPENROUTER_ROUTING JSON).
  // Values are embedded as model.options.provider — the @openrouter/ai-sdk-provider spreads
  // everything in providerOptions.openrouter directly into the request body, so
  // { provider: { only, data_collection, ... } } becomes body.provider = OpenRouter routing.
  let routingOpts: Record<string, unknown> | undefined;
  if (provider === 'openrouter' && process.env.OPENCODE_OPENROUTER_ROUTING) {
    try {
      routingOpts = JSON.parse(process.env.OPENCODE_OPENROUTER_ROUTING) as Record<string, unknown>;
    } catch {
      log('Warning: OPENCODE_OPENROUTER_ROUTING is not valid JSON, ignoring');
    }
  }
  // Declaring a model in provider.<id>.models to bypass the bundled-list check
  // also DROPS the modality metadata models.dev would have supplied. With no
  // modalities, OpenCode treats the model as text-only and silently strips
  // image file parts before the upstream call — the model then never sees the
  // image and (in the DeepSeek→Mistral switch) falls back to a Read tool call
  // on the inbox path, returning "I can't read images". Declaring image input
  // restores vision forwarding. Override via OPENCODE_MODEL_INPUT_MODALITIES
  // (comma-separated, e.g. "text" for a text-only model).
  const inputModalities = (process.env.OPENCODE_MODEL_INPUT_MODALITIES || 'text,image')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const modelEntry = {
    ...(routingOpts ? { options: { provider: routingOpts } } : {}),
    modalities: { input: inputModalities, output: ['text'] },
  };

  const providerModels: Record<string, unknown> = {};
  const mainSlug = modelSlug(provider, model);
  const smallSlug = modelSlug(provider, smallModel);
  if (mainSlug) providerModels[mainSlug] = modelEntry;
  if (smallSlug) providerModels[smallSlug] = modelEntry;

  const providerOptions: Record<string, unknown> =
    provider === 'anthropic'
      ? {}
      : {
          [provider]: {
            ...(Object.keys(providerModels).length > 0 ? { models: providerModels } : {}),
            // Auth is handled at the proxy layer (ANTHROPIC_BASE_URL / OneCLI).
            // Use OPENROUTER_API_KEY if provided; otherwise omit so OpenCode
            // falls back to its own auth.json or the proxy-injected credential.
            options: {
              ...(process.env.OPENROUTER_API_KEY ? { apiKey: process.env.OPENROUTER_API_KEY } : {}),
              baseURL: proxyUrl,
            },
          },
        };

  const mcp = mcpServersToOpenCodeConfig(options.mcpServers);

  // Load shared base + per-group fragments + per-group memory through OpenCode's
  // native instructions pipeline (session/instruction.ts). Absolute paths with
  // globs are supported. Files are read raw — `@./...` includes are NOT expanded
  // by OpenCode, so point at the concrete files, not at composed CLAUDE.md.
  const instructions = [
    '/app/CLAUDE.md',
    '/workspace/agent/.claude-fragments/*.md',
    '/workspace/agent/CLAUDE.local.md',
  ];

  return {
    ...(model ? { model } : {}),
    ...(smallModel ? { small_model: smallModel } : {}),
    enabled_providers: [provider],
    permission: 'allow',
    autoupdate: false,
    snapshot: false,
    provider: providerOptions,
    instructions,
    mcp,
  };
}

export type SharedRuntime = {
  proc: ChildProcess;
  client: OpencodeClient;
  stream: AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>;
  streamRelease: () => void;
};

let sharedRuntime: SharedRuntime | null = null;
let sharedConfigKey: string | null = null;
let sharedInit: Promise<SharedRuntime> | null = null;

function runtimeConfigKey(options: ProviderOptions): string {
  return JSON.stringify({
    mcp: mcpServersToOpenCodeConfig(options.mcpServers),
    model: process.env.OPENCODE_MODEL,
    small: process.env.OPENCODE_SMALL_MODEL,
    op: process.env.OPENCODE_PROVIDER,
  });
}

async function ensureSharedRuntime(options: ProviderOptions): Promise<SharedRuntime> {
  const key = runtimeConfigKey(options);
  if (sharedRuntime && sharedConfigKey === key) return sharedRuntime;

  if (sharedInit) return sharedInit;

  sharedInit = (async () => {
    if (sharedRuntime) {
      destroySharedRuntime();
    }
    const config = buildOpenCodeConfig(options);
    const { url, proc } = await spawnOpencodeServer(config);
    const client = createOpencodeClient({ baseUrl: url });
    const sub = await client.event.subscribe();
    const stream = sub.stream as AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>;
    sharedRuntime = {
      proc,
      client,
      stream,
      streamRelease: () => {
        void stream.return?.(undefined);
      },
    };
    sharedConfigKey = key;
    sharedInit = null;
    return sharedRuntime;
  })();

  return sharedInit;
}

export function destroySharedRuntime(): void {
  if (sharedRuntime) {
    try {
      sharedRuntime.streamRelease();
    } catch {
      /* ignore */
    }
    killProcessTree(sharedRuntime.proc);
    sharedRuntime = null;
    sharedConfigKey = null;
  }
  sharedInit = null;
}

/**
 * Test hook: inject a pre-built runtime instead of spawning a real OpenCode
 * server process. Bypasses spawnOpencodeServer entirely. Call in beforeEach,
 * then _setRuntimeForTest(null) in afterEach.
 *
 * The injected config key is set to match whatever runtimeConfigKey() returns
 * for the current env, so ensureSharedRuntime() returns the mock immediately
 * instead of falling through to spawnOpencodeServer.
 */
export function _setRuntimeForTest(rt: SharedRuntime | null): void {
  sharedRuntime = rt;
  // Use the real config key so ensureSharedRuntime's equality check passes.
  sharedConfigKey = rt ? runtimeConfigKey({}) : null;
  sharedInit = null;
}

function sessionErrorMessage(props: { error?: unknown }): string {
  const err = props.error as { data?: { message?: string } } | undefined;
  if (err && typeof err === 'object' && err.data && typeof err.data.message === 'string') {
    return err.data.message;
  }
  return JSON.stringify(props.error) || 'OpenCode session error';
}

export class OpenCodeProvider implements AgentProvider {
  readonly supportsNativeSlashCommands = false;

  private readonly options: ProviderOptions;
  private activeSessionId: string | undefined;

  constructor(options: ProviderOptions = {}) {
    this.options = options;
  }

  isSessionInvalid(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return STALE_SESSION_RE.test(msg);
  }

  query(input: QueryInput): AgentQuery {
    if (input.continuation) {
      this.activeSessionId = input.continuation;
    } else {
      this.activeSessionId = undefined;
    }

    interface PendingTurn {
      text: string;
      attachments?: AttachmentRef[];
    }

    const pending: PendingTurn[] = [];
    let waiting: (() => void) | null = null;
    let ended = false;
    let aborted = false;

    const systemInstructions = input.systemContext?.instructions;
    pending.push({ text: input.prompt, attachments: input.attachments });

    const kick = (): void => {
      waiting?.();
    };

    const self = this;
    const IDLE_TIMEOUT_MS = Number(process.env.OPENCODE_IDLE_TIMEOUT_MS) || 300_000;

    async function* gen(): AsyncGenerator<ProviderEvent> {
      let initYielded = false;
      const rt = await ensureSharedRuntime(self.options);
      const { client, stream } = rt;

      // Drain window helper: defined here (inside gen(), above any loop) so
      // all lexical declarations live in function scope and never trigger
      // no-case-declarations when called from the `session.idle` switch arm.
      // Closes over `stream`, `IDLE_DRAIN_WINDOW_MS`, and `logDebug`.
      // Mutable per-attempt state (`partTextByMessageId`, `sessionId`,
      // `lastEventAt`) is passed in explicitly so the function compiles
      // cleanly without capturing stale bindings across retry attempts.
      async function drainIdleWindow(
        partTextByMessageId: Map<string, string>,
        sessionId: string,
        updateLastEventAt: (t: number) => void,
      ): Promise<void> {
        type DrainEvent = { type: string; properties: Record<string, unknown> };
        type DrainOutcome = { timedOut: false; value: DrainEvent | undefined; done: boolean } | { timedOut: true };
        const drainDeadline = Date.now() + IDLE_DRAIN_WINDOW_MS;
        while (true) {
          const remaining = drainDeadline - Date.now();
          if (remaining <= 0) break;
          const outcome = await (Promise.race([
            stream.next().then(
              (r): DrainOutcome => ({
                timedOut: false,
                value: r.value ?? undefined,
                done: r.done ?? false,
              }),
            ),
            new Promise<DrainOutcome>((resolve) => setTimeout(() => resolve({ timedOut: true }), remaining)),
          ]) as Promise<DrainOutcome>);
          if (outcome.timedOut) break;
          if (outcome.done) break;
          const drainEv = outcome.value;
          if (!drainEv?.type) continue;
          if (drainEv.type === 'server.heartbeat' || drainEv.type === 'server.connected') {
            logDebug('drain: heartbeat');
            continue;
          }
          updateLastEventAt(Date.now());
          logDebug(`drain: event ${drainEv.type}`);
          if (drainEv.type === 'message.part.updated') {
            const drainPart = drainEv.properties.part as
              | { type?: string; messageID?: string; text?: string }
              | undefined;
            if (drainPart?.type === 'text' && drainPart.messageID && drainPart.text) {
              partTextByMessageId.set(drainPart.messageID, drainPart.text);
              logDebug(`drain: captured trailing text for msg ${drainPart.messageID}`);
            }
          } else if (drainEv.type === 'session.idle') {
            // Second idle for same session — genuinely done
            const innerSid = (drainEv.properties as { sessionID?: string }).sessionID;
            if (innerSid === sessionId) break;
          }
        }
      }

      while (!aborted) {
        while (pending.length === 0 && !ended && !aborted) {
          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
          waiting = null;
        }

        if (aborted) return;
        if (pending.length === 0 && ended) return;

        const { text, attachments: turnAttachments } = pending.shift()!;

        // Build file parts for any image attachments in this turn.
        // The files are already saved to the session inbox by the host. We must
        // inline them as base64 `data:` URLs — NOT `file://` URLs. OpenCode
        // treats a `file://` part as a `resource_link` (a mere reference) and
        // does NOT forward the image bytes into the user turn; only `data:`
        // URLs are decoded into actual `type:"image"` content the model can
        // see. (With a `file://` URL the model receives only the text hint,
        // then calls the Read tool — delivering the image as a tool RESULT,
        // a position vision providers like Mistral/DeepInfra won't process,
        // so the model replies "I can't read images".)
        //
        // Two conditions must BOTH hold for the image to reach the model:
        //   1. a base64 `data:` URL part here (so the bytes are inlined), and
        //   2. the model declared with an `image` input modality
        //      (see buildOpenCodeConfig) — otherwise OpenCode strips the part.
        // Point OPENCODE_MODEL at a vision-capable model and keep image in
        // OPENCODE_MODEL_INPUT_MODALITIES (the default).
        const fileParts: Array<{ type: 'file'; mime: string; filename?: string; url: string }> = [];
        if (turnAttachments && turnAttachments.length > 0) {
          for (const att of turnAttachments) {
            if (!att.mimeType.startsWith('image/')) continue;
            try {
              const base64 = _readImageBase64(att.localPath);
              fileParts.push({
                type: 'file',
                mime: att.mimeType,
                filename: att.name,
                url: `data:${att.mimeType};base64,${base64}`,
              });
              logDebug(`Attaching image: ${att.name ?? att.localPath} (${att.mimeType}, ${base64.length} b64 chars)`);
            } catch (err) {
              log(
                `Failed to read image attachment /workspace/${att.localPath}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }

        // ── Retry loop ──────────────────────────────────────────────────────────
        // Each attempt: create/reuse session → promptAsync → stream events.
        // On a retryable error (504, timeout, 5xx) we clear the dead session,
        // reset initYielded so the poll-loop gets a fresh continuation, back off,
        // and try again.  Non-retryable errors (4xx, auth, model-not-found) and
        // aborts propagate immediately.  RETRY_ENABLED=false collapses to 1 attempt.
        const maxAttempts = RETRY_ENABLED ? RETRY_MAX_ATTEMPTS : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (attempt > 1) {
            const delay = retryDelay(attempt);
            log(`Turn error — retrying (attempt ${attempt}/${maxAttempts}, backoff ${delay}ms)`);
            await _sleepFn(delay);
          }

          try {
            // activeSessionId was cleared in the catch block on retry
            let sessionId = self.activeSessionId;

            if (!sessionId) {
              const created = await client.session.create();
              if (created.error) {
                throw new Error(`OpenCode: failed to create session: ${JSON.stringify(created.error)}`);
              }
              sessionId = created.data?.id;
              if (!sessionId) throw new Error('OpenCode: failed to create session (no id)');
              self.activeSessionId = sessionId;
            }

            if (!initYielded) {
              yield { type: 'init', continuation: sessionId };
              initYielded = true;
            }

            const promptRes = await client.session.promptAsync({
              path: { id: sessionId },
              body: {
                parts: [{ type: 'text', text }, ...fileParts],
                // Deliver the NanoClaw runtime addendum (agent name + live
                // destinations + message-wrapping rules) as a real system
                // message. Do NOT fold it into the user turn — Mistral-family
                // models echo `<system>` XML back verbatim instead of obeying it.
                ...(systemInstructions ? { system: systemInstructions } : {}),
              },
            });
            if (promptRes.error) {
              // Throw so the catch block decides whether to retry
              throw new Error(`OpenCode promptAsync: ${JSON.stringify(promptRes.error)}`);
            }

            const partTextByMessageId = new Map<string, string>();
            const roleByMessageId = new Map<string, string>();
            let lastEventAt = Date.now();
            let eventTimedOut = false;
            const timeoutCheck = setInterval(() => {
              if (Date.now() - lastEventAt > IDLE_TIMEOUT_MS) {
                log(`OpenCode event timeout (${IDLE_TIMEOUT_MS}ms) — aborting session ${sessionId}`);
                eventTimedOut = true;
                self.activeSessionId = undefined;
                // Do NOT destroy shared runtime — OpenCode server + SSE stream may be healthy
                // for other sessions. Only this session's query stalled. destroySharedRuntime()
                // kills the server process for everyone, breaking concurrent agents.
                kick();
              }
            }, 5000);

            try {
              turn: while (true) {
                if (aborted) return;
                if (eventTimedOut) {
                  throw new Error(`OpenCode event timeout (${IDLE_TIMEOUT_MS}ms)`);
                }

                const { value: ev, done } = await stream.next();
                if (done) {
                  throw new Error('OpenCode SSE stream ended unexpectedly');
                }

                // Update idle timer BEFORE filtering — heartbeats and connection events
                // prove the SSE stream is alive even if no message events arrived yet
                // (e.g. during extended model computation). Without this, long-running
                // turns always timeout at IDLE_TIMEOUT_MS regardless of health.
                lastEventAt = Date.now();

                if (!ev?.type || ev.type === 'server.connected' || ev.type === 'server.heartbeat') {
                  logDebug(`heartbeat`);
                  continue;
                }

                logDebug(`event: ${ev.type}`);
                yield { type: 'activity' };

                switch (ev.type) {
                  case 'message.updated': {
                    const info = ev.properties.info as { id?: string; role?: string } | undefined;
                    if (info?.id && info?.role) {
                      roleByMessageId.set(info.id, info.role);
                    }
                    break;
                  }
                  case 'message.part.updated': {
                    const part = ev.properties.part as { type?: string; messageID?: string; text?: string } | undefined;
                    if (part?.type === 'text' && part.messageID && part.text) {
                      partTextByMessageId.set(part.messageID, part.text);
                    }
                    break;
                  }
                  case 'permission.updated': {
                    const perm = ev.properties as { id?: string; sessionID?: string };
                    if (perm.sessionID === sessionId && perm.id) {
                      try {
                        await client.postSessionIdPermissionsPermissionId({
                          path: { id: sessionId, permissionID: perm.id },
                          body: { response: 'always' },
                        });
                      } catch (err) {
                        log(`Failed to auto-reply permission: ${err instanceof Error ? err.message : String(err)}`);
                      }
                    }
                    break;
                  }
                  case 'session.status': {
                    const props = ev.properties as {
                      sessionID?: string;
                      status?: { type?: string; attempt?: number; message?: string };
                    };
                    if (props.sessionID !== sessionId) break;
                    const st = props.status;
                    if (
                      st?.type === 'retry' &&
                      typeof st.attempt === 'number' &&
                      st.attempt >= SESSION_STATUS_RETRY_ERROR_AFTER &&
                      st.message
                    ) {
                      self.activeSessionId = undefined;
                      throw new Error(`OpenCode retry limit (${st.attempt}): ${st.message}`);
                    }
                    break;
                  }
                  case 'session.error': {
                    const props = ev.properties as { sessionID?: string; error?: unknown };
                    if (props.sessionID === sessionId || props.sessionID === undefined) {
                      self.activeSessionId = undefined;
                      throw new Error(sessionErrorMessage(props));
                    }
                    break;
                  }
                  case 'session.idle': {
                    const sid = (ev.properties as { sessionID?: string }).sessionID;
                    if (sid === sessionId) {
                      // Drain window — see drainIdleWindow helper defined above
                      // the main loop. The labeled `break turn` must be here
                      // (outside the function boundary of drainIdleWindow).
                      // Note on Promise.race + stream.next(): if the timeout fires
                      // first the pending stream.next() remains in-flight and will
                      // consume the next SSE event (typically a heartbeat) without
                      // anyone observing the result. For a single-session agent
                      // this is acceptable — the eaten event is benign.
                      await drainIdleWindow(partTextByMessageId, sessionId, (t) => {
                        lastEventAt = t;
                      });
                      break turn;
                    }
                    break;
                  }
                  default:
                    break;
                }
              }
            } finally {
              clearInterval(timeoutCheck);
            }

            let resultText = '';
            for (const [msgId, role] of roleByMessageId) {
              if (role === 'assistant') {
                resultText = partTextByMessageId.get(msgId) ?? resultText;
              }
            }
            yield { type: 'result', text: resultText || null };
            break; // success — exit retry loop
          } catch (err) {
            self.activeSessionId = undefined;
            initYielded = false; // force fresh init event with next session id on retry

            const willRetry = isRetryableError(err) && attempt < maxAttempts && !aborted;
            if (!willRetry) throw err;
            log(`Turn error (attempt ${attempt}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)}`);
          }
        } // end attemptLoop
      }
    }

    return {
      push: (message: string, attachments?: AttachmentRef[]) => {
        pending.push({ text: message, attachments });
        kick();
      },
      end: () => {
        ended = true;
        kick();
      },
      events: gen(),
      abort: () => {
        aborted = true;
        this.activeSessionId = undefined;
        kick();
        destroySharedRuntime();
      },
    };
  }
}

registerProvider('opencode', (opts) => new OpenCodeProvider(opts));
