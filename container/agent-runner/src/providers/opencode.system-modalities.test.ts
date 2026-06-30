/**
 * Regression tests for the DeepSeek→Mistral provider switch fixes.
 *
 * Two behaviors that broke when swapping a text-only DeepSeek model for a
 * vision-capable Mistral model on OpenRouter, both fixed in opencode.ts:
 *
 *   1. Vision modalities (buildOpenCodeConfig)
 *      Explicitly declaring a model under provider.<id>.models (to dodge
 *      ProviderModelNotFoundError) drops the modality metadata models.dev would
 *      supply, so OpenCode defaulted the model to text-only and stripped image
 *      file parts before the upstream call. We now declare an `image` input
 *      modality by default (override via OPENCODE_MODEL_INPUT_MODALITIES).
 *
 *   2. System prompt delivery (promptAsync body.system)
 *      The runtime addendum (agent name + destinations + message-wrapping
 *      rules) used to be folded into the user turn as <system>...</system>
 *      XML. DeepSeek obeyed it; Mistral echoed it back verbatim. It now rides
 *      the dedicated `system` field on the promptAsync body — a real system
 *      message — and never appears in the user text part.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ChildProcess } from 'child_process';

import {
  OpenCodeProvider,
  buildOpenCodeConfig,
  _setRuntimeForTest,
  _setSleepForTest,
  type SharedRuntime,
} from './opencode.js';
import type { ProviderEvent } from './types.js';

// ── Env snapshot/restore ──────────────────────────────────────────────────────
// buildOpenCodeConfig reads process.env at call time. Snapshot the keys we
// touch so each test starts from a known state and never leaks into the next.

const ENV_KEYS = [
  'OPENCODE_PROVIDER',
  'OPENCODE_MODEL',
  'OPENCODE_SMALL_MODEL',
  'OPENCODE_MODEL_INPUT_MODALITIES',
  'OPENCODE_OPENROUTER_ROUTING',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_BASE_URL',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _setSleepForTest(() => Promise.resolve());
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _setRuntimeForTest(null);
  _setSleepForTest((ms) => new Promise((r) => setTimeout(r, ms)));
});

// ── Helpers to dig into the config shape ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function modelsFor(config: Record<string, unknown>, provider: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prov = (config.provider as Record<string, any>)?.[provider];
  return prov?.models ?? {};
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Vision modalities in buildOpenCodeConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildOpenCodeConfig — vision modalities', () => {
  it('declares text+image input modality by default for an openrouter model', () => {
    process.env.OPENCODE_PROVIDER = 'openrouter';
    process.env.OPENCODE_MODEL = 'openrouter/mistralai/mistral-small-3.2-24b-instruct';

    const config = buildOpenCodeConfig({});
    const models = modelsFor(config, 'openrouter');
    const slug = 'mistralai/mistral-small-3.2-24b-instruct';

    expect(models[slug]).toBeDefined();
    expect(models[slug].modalities.input).toEqual(['text', 'image']);
    expect(models[slug].modalities.output).toEqual(['text']);
  });

  it('honors OPENCODE_MODEL_INPUT_MODALITIES to force text-only', () => {
    process.env.OPENCODE_PROVIDER = 'openrouter';
    process.env.OPENCODE_MODEL = 'openrouter/some/text-only-model';
    process.env.OPENCODE_MODEL_INPUT_MODALITIES = 'text';

    const config = buildOpenCodeConfig({});
    const models = modelsFor(config, 'openrouter');
    expect(models['some/text-only-model'].modalities.input).toEqual(['text']);
  });

  it('parses a comma+whitespace separated modality override', () => {
    process.env.OPENCODE_PROVIDER = 'openrouter';
    process.env.OPENCODE_MODEL = 'openrouter/some/multi-model';
    process.env.OPENCODE_MODEL_INPUT_MODALITIES = 'text, image, pdf';

    const config = buildOpenCodeConfig({});
    const models = modelsFor(config, 'openrouter');
    expect(models['some/multi-model'].modalities.input).toEqual(['text', 'image', 'pdf']);
  });

  it('applies modalities to both the main and the small model slug', () => {
    process.env.OPENCODE_PROVIDER = 'openrouter';
    process.env.OPENCODE_MODEL = 'openrouter/x/main-model';
    process.env.OPENCODE_SMALL_MODEL = 'openrouter/x/small-model';

    const config = buildOpenCodeConfig({});
    const models = modelsFor(config, 'openrouter');
    expect(models['x/main-model'].modalities.input).toEqual(['text', 'image']);
    expect(models['x/small-model'].modalities.input).toEqual(['text', 'image']);
  });

  it('keeps OpenRouter routing options alongside the modalities declaration', () => {
    process.env.OPENCODE_PROVIDER = 'openrouter';
    process.env.OPENCODE_MODEL = 'openrouter/x/routed-model';
    process.env.OPENCODE_OPENROUTER_ROUTING = JSON.stringify({ only: ['deepinfra'], sort: 'price' });

    const config = buildOpenCodeConfig({});
    const entry = modelsFor(config, 'openrouter')['x/routed-model'];
    // Both the routing options and the modalities must survive on the same entry
    expect(entry.options.provider).toEqual({ only: ['deepinfra'], sort: 'price' });
    expect(entry.modalities.input).toEqual(['text', 'image']);
  });

  it('drops empty entries from a sloppy modality override', () => {
    process.env.OPENCODE_PROVIDER = 'openrouter';
    process.env.OPENCODE_MODEL = 'openrouter/x/m';
    process.env.OPENCODE_MODEL_INPUT_MODALITIES = 'text,,image,';

    const config = buildOpenCodeConfig({});
    expect(modelsFor(config, 'openrouter')['x/m'].modalities.input).toEqual(['text', 'image']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. System prompt delivery via promptAsync body.system
// ═══════════════════════════════════════════════════════════════════════════════

type SseEvent = { type: string; properties: Record<string, unknown> };

function makeStream(events: SseEvent[]): AsyncGenerator<SseEvent, void, void> {
  return (async function* () {
    for (const ev of events) yield ev;
  })();
}

const PROMPT_OK = { data: {}, error: null };

function makeRuntime(stream: AsyncGenerator<SseEvent, void, void>): SharedRuntime {
  return {
    proc: {} as ChildProcess,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: {
      session: {
        create: mock(() => Promise.resolve({ data: { id: 's1' }, error: null })),
        promptAsync: mock(() => Promise.resolve(PROMPT_OK)),
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    stream: stream as AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>,
    streamRelease: () => {},
  };
}

async function drain(provider: OpenCodeProvider, input: Parameters<typeof provider.query>[0]): Promise<void> {
  const q = provider.query(input);
  for await (const ev of q.events as AsyncIterable<ProviderEvent>) {
    if (ev.type === 'result') break;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastBody(rt: SharedRuntime): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls = (rt.client.session.promptAsync as any).mock.calls;
  return calls[calls.length - 1][0].body;
}

describe('OpenCodeProvider — system prompt via promptAsync body.system', () => {
  it('passes systemContext.instructions through the body.system field', async () => {
    const rt = makeRuntime(makeStream([{ type: 'session.idle', properties: { sessionID: 's1' } }]));
    _setRuntimeForTest(rt);

    await drain(new OpenCodeProvider(), {
      prompt: 'hello',
      cwd: '/test',
      systemContext: { instructions: '# You are Claudette\n\n## Sending messages\n...' },
    });

    expect(lastBody(rt).system).toBe('# You are Claudette\n\n## Sending messages\n...');
  });

  it('omits body.system entirely when no instructions are provided', async () => {
    const rt = makeRuntime(makeStream([{ type: 'session.idle', properties: { sessionID: 's1' } }]));
    _setRuntimeForTest(rt);

    await drain(new OpenCodeProvider(), { prompt: 'hello', cwd: '/test' });

    expect('system' in lastBody(rt)).toBe(false);
  });

  it('does NOT fold instructions into the user text part as <system> XML', async () => {
    const rt = makeRuntime(makeStream([{ type: 'session.idle', properties: { sessionID: 's1' } }]));
    _setRuntimeForTest(rt);

    await drain(new OpenCodeProvider(), {
      prompt: 'the user message',
      cwd: '/test',
      systemContext: { instructions: 'SECRET RULES' },
    });

    const body = lastBody(rt);
    const textPart = body.parts.find((p: { type: string }) => p.type === 'text');
    // The user turn carries ONLY the raw prompt — no XML wrapper, no leakage.
    expect(textPart.text).toBe('the user message');
    expect(textPart.text).not.toContain('<system>');
    expect(textPart.text).not.toContain('SECRET RULES');
  });
});
