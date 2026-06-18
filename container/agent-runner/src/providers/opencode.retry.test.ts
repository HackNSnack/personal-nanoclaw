/**
 * Tests for the OpenCode provider retry logic.
 *
 * Strategy: inject a mock SharedRuntime via _setRuntimeForTest to bypass
 * spawnOpencodeServer, then drive the generator through controlled sequences
 * of session.create / promptAsync results and SSE stream events.
 *
 * The mock stream is a simple async generator over a pre-built event array.
 * _setSleepForTest replaces the real sleep with a no-op so tests are instant.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ChildProcess } from 'child_process';

import type { ProviderEvent } from './types.js';
import {
  OpenCodeProvider,
  _setRuntimeForTest,
  _setSleepForTest,
  isRetryableError,
  retryDelay,
  type SharedRuntime,
} from './opencode.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

type SseEvent = { type: string; properties: Record<string, unknown> };

/** Build a mock SSE stream from a fixed array of events. */
async function* makeStream(events: SseEvent[]): AsyncGenerator<SseEvent> {
  for (const ev of events) {
    yield ev;
  }
}

/** session.idle event for a given session id — marks a successful turn end. */
function idleEvent(sessionId: string): SseEvent {
  return { type: 'session.idle', properties: { sessionID: sessionId } };
}

/** session.error event carrying a 504 payload (the real-world trigger). */
function timeoutErrorEvent(sessionId: string): SseEvent {
  return {
    type: 'session.error',
    properties: {
      sessionID: sessionId,
      error: { code: 504, message: 'Upstream idle timeout exceeded', metadata: { error_type: 'timeout' } },
    },
  };
}

/** A promptAsync result with no error. */
const PROMPT_OK = { data: {}, error: null };

/** A promptAsync result that mirrors a 504 from OpenRouter. */
const PROMPT_504 = {
  data: null,
  error: { code: 504, message: 'Upstream idle timeout exceeded', metadata: { error_type: 'timeout' } },
};

/** A promptAsync result that mirrors a 401 auth error (non-retryable). */
const PROMPT_401 = {
  data: null,
  error: { code: 401, message: 'AuthenticationError: invalid API key' },
};

/**
 * Build a mock SharedRuntime.
 *
 * @param sessions  Array of session ids to hand out sequentially on create()
 * @param prompts   Array of promptAsync return values (cycled if shorter than calls)
 * @param stream    SSE event stream the client will read from
 */
function makeRuntime(
  sessions: string[],
  prompts: Array<typeof PROMPT_OK | typeof PROMPT_504 | typeof PROMPT_401>,
  stream: AsyncGenerator<SseEvent>,
): SharedRuntime {
  let sessionIdx = 0;
  let promptIdx = 0;

  const mockClient = {
    session: {
      create: mock(() => {
        const id = sessions[sessionIdx++] ?? `sess-auto-${sessionIdx}`;
        return Promise.resolve({ data: { id }, error: null });
      }),
      promptAsync: mock(() => {
        const result = prompts[promptIdx] ?? PROMPT_OK;
        promptIdx++;
        return Promise.resolve(result);
      }),
    },
  };

  return {
    proc: {} as ChildProcess,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: mockClient as any,
    stream: stream as AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>,
    streamRelease: () => {},
  };
}

/** Collect all events from a query, stopping after the first 'result' event. */
async function collectToResult(provider: OpenCodeProvider, prompt = 'hello'): Promise<ProviderEvent[]> {
  const q = provider.query({ prompt, cwd: '/test' });
  const collected: ProviderEvent[] = [];
  for await (const ev of q.events) {
    collected.push(ev);
    if (ev.type === 'result') break;
  }
  return collected;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Replace real sleep with a no-op so retry backoff is instant in tests.
  _setSleepForTest(() => Promise.resolve());
});

afterEach(() => {
  // Clean up injected runtime and restore real sleep.
  _setRuntimeForTest(null);
  _setSleepForTest((ms) => new Promise((r) => setTimeout(r, ms)));
});

// ── isRetryableError ─────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  it('returns true for a 504 error object', () => {
    expect(isRetryableError(new Error('{"code":504,"message":"Upstream idle timeout exceeded"}'))).toBe(true);
  });

  it('returns true for a plain "Upstream idle timeout exceeded" string error', () => {
    expect(isRetryableError(new Error('Upstream idle timeout exceeded'))).toBe(true);
  });

  it('returns true for other 5xx codes', () => {
    expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('returns true for network timeout errors', () => {
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('ECONNRESET: connection reset by peer'))).toBe(true);
    expect(isRetryableError(new Error('deadline exceeded'))).toBe(true);
  });

  it('returns true for "event timeout" (provider-level idle)', () => {
    expect(isRetryableError(new Error('OpenCode event timeout (300000ms)'))).toBe(true);
  });

  it('returns true for "temporarily unavailable"', () => {
    expect(isRetryableError(new Error('Service temporarily unavailable'))).toBe(true);
  });

  it('returns false for a 401 auth error', () => {
    expect(isRetryableError(new Error('401 AuthenticationError: invalid key'))).toBe(false);
  });

  it('returns false for a 403 permission error', () => {
    expect(isRetryableError(new Error('403 PermissionError: forbidden'))).toBe(false);
  });

  it('returns false for a 400 bad request', () => {
    expect(isRetryableError(new Error('400 InvalidRequestError: bad input'))).toBe(false);
  });

  it('returns false for a 404 not found', () => {
    expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
  });

  it('returns false for a 429 rate limit', () => {
    expect(isRetryableError(new Error('429 rate limit exceeded'))).toBe(false);
  });

  it('returns false for model not found errors', () => {
    expect(isRetryableError(new Error('ProviderModelNotFoundError: no such model'))).toBe(false);
    expect(isRetryableError(new Error('model not found: deepseek/bad-model'))).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRetryableError(new Error(''))).toBe(false);
  });

  it('accepts non-Error values (plain strings)', () => {
    expect(isRetryableError('504 gateway timeout')).toBe(true);
    expect(isRetryableError('401 unauthorized')).toBe(false);
  });
});

// ── retryDelay ───────────────────────────────────────────────────────────────

describe('retryDelay', () => {
  it('returns 0 for attempt 1 (no backoff before first attempt)', () => {
    expect(retryDelay(1, 1000, 60_000)).toBe(0);
  });

  it('returns a value at least equal to base for attempt 2', () => {
    const d = retryDelay(2, 1000, 60_000);
    // base = 1000, max jitter = 300 → range [1000, 1300]
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(1300);
  });

  it('doubles base each extra attempt', () => {
    // attempt 3 → base * 2 = 2000
    const d = retryDelay(3, 1000, 60_000);
    expect(d).toBeGreaterThanOrEqual(2000);
    expect(d).toBeLessThanOrEqual(2600);
  });

  it('is clamped by maxMs', () => {
    // base 1000, max 500 → always ≤ 500 + jitter (650)
    const d = retryDelay(10, 1000, 500);
    expect(d).toBeLessThanOrEqual(650);
  });

  it('never exceeds maxMs + 30% jitter', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const d = retryDelay(attempt, 1000, 60_000);
      expect(d).toBeLessThanOrEqual(60_000 * 1.3);
    }
  });
});

// ── Retry behaviour ───────────────────────────────────────────────────────────

describe('OpenCodeProvider retry behaviour', () => {
  it('succeeds on first attempt without retrying', async () => {
    const stream = makeStream([idleEvent('sess-1')]);
    _setRuntimeForTest(makeRuntime(['sess-1'], [PROMPT_OK], stream));

    const provider = new OpenCodeProvider();
    const events = await collectToResult(provider);

    const types = events.map((e) => e.type);
    expect(types).toContain('init');
    expect(types).toContain('result');
    // Only one init — no retry needed
    expect(types.filter((t) => t === 'init').length).toBe(1);
  });

  it('retries once after a 504 promptAsync error and succeeds', async () => {
    // First promptAsync: 504. Second: success.
    // Stream only needs to serve the second session.
    const stream = makeStream([idleEvent('sess-2')]);
    _setRuntimeForTest(makeRuntime(['sess-1', 'sess-2'], [PROMPT_504, PROMPT_OK], stream));

    const provider = new OpenCodeProvider();
    const events = await collectToResult(provider);

    const types = events.map((e) => e.type);
    // Two init events: one for sess-1 (before failure), one for sess-2 (retry)
    expect(types.filter((t) => t === 'init').length).toBe(2);
    expect(types.at(-1)).toBe('result');

    // Continuation on the final init should be the retry session
    const inits = events.filter((e) => e.type === 'init') as Array<{ type: 'init'; continuation: string }>;
    expect(inits[0].continuation).toBe('sess-1');
    expect(inits[1].continuation).toBe('sess-2');
  });

  it('retries after a session.error 504 from the stream', async () => {
    // Session 1 gets a session.error mid-stream; session 2 succeeds.
    const stream = makeStream([
      timeoutErrorEvent('sess-1'), // triggers retry
      idleEvent('sess-2'), // consumed by retry attempt
    ]);
    _setRuntimeForTest(makeRuntime(['sess-1', 'sess-2'], [PROMPT_OK, PROMPT_OK], stream));

    const provider = new OpenCodeProvider();
    const events = await collectToResult(provider);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'init').length).toBe(2);
    expect(types.at(-1)).toBe('result');
  });

  it('does NOT retry a non-retryable 401 promptAsync error', async () => {
    const stream = makeStream([]); // never reached
    _setRuntimeForTest(makeRuntime(['sess-1'], [PROMPT_401], stream));

    const provider = new OpenCodeProvider();
    const q = provider.query({ prompt: 'hello', cwd: '/test' });

    let threw = false;
    try {
      for await (const ev of q.events) {
        if (ev.type === 'result') break;
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
  });

  it('exhausts all retries and throws when every attempt fails', async () => {
    // Three 504 errors (= RETRY_MAX_ATTEMPTS = 3 by default)
    const stream = makeStream([]);
    _setRuntimeForTest(makeRuntime(['sess-1', 'sess-2', 'sess-3'], [PROMPT_504, PROMPT_504, PROMPT_504], stream));

    const provider = new OpenCodeProvider();
    const q = provider.query({ prompt: 'hello', cwd: '/test' });

    let threw = false;
    let lastErr: unknown;
    try {
      for await (const ev of q.events) {
        if (ev.type === 'result') break;
      }
    } catch (err) {
      threw = true;
      lastErr = err;
    }

    expect(threw).toBe(true);
    // Error message should mention 504
    expect(String(lastErr)).toMatch(/504/);
  });

  it('creates a fresh session for each retry attempt', async () => {
    const stream = makeStream([idleEvent('sess-3')]);
    const runtime = makeRuntime(['sess-1', 'sess-2', 'sess-3'], [PROMPT_504, PROMPT_504, PROMPT_OK], stream);
    _setRuntimeForTest(runtime);

    const provider = new OpenCodeProvider();
    await collectToResult(provider);

    // session.create should have been called 3 times (once per attempt)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createCalls = (runtime.client.session.create as any).mock?.calls?.length ?? 0;
    expect(createCalls).toBe(3);
  });

  it('succeeds on second attempt after stream-level session.error', async () => {
    const stream = makeStream([timeoutErrorEvent('sess-1'), idleEvent('sess-2')]);
    _setRuntimeForTest(makeRuntime(['sess-1', 'sess-2'], [PROMPT_OK, PROMPT_OK], stream));

    const provider = new OpenCodeProvider();
    const events = await collectToResult(provider);

    expect(events.at(-1)?.type).toBe('result');
  });

  it('clears activeSessionId after each failed attempt so the next creates fresh', async () => {
    // After two 504s the third attempt creates a new session rather than
    // re-using a dead one.
    const stream = makeStream([idleEvent('sess-3')]);
    _setRuntimeForTest(makeRuntime(['sess-1', 'sess-2', 'sess-3'], [PROMPT_504, PROMPT_504, PROMPT_OK], stream));

    const provider = new OpenCodeProvider();
    const events = await collectToResult(provider);

    const inits = events.filter((e) => e.type === 'init') as Array<{ type: 'init'; continuation: string }>;
    // Three distinct session ids — no reuse of a dead session
    const ids = inits.map((e) => e.continuation);
    expect(new Set(ids).size).toBe(3);
  });
});
