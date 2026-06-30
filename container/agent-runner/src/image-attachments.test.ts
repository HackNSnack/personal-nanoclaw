/**
 * Image attachment pipeline tests.
 *
 * End-to-end coverage of the three-layer feature that lets vision-capable
 * models see images uploaded to Slack (or any Chat SDK platform):
 *
 *   Layer 1 — extractImageAttachments()
 *     poll-loop helper that reads the session-inbox file references from
 *     message content (written there by the host's extractAttachmentFiles)
 *     and builds an AttachmentRef[].
 *
 *   Layer 2 — Formatter attachment rendering
 *     The textual hint appended to the XML prompt so the agent always knows
 *     where the file lives even when the provider also forwards raw bytes.
 *     Shape: "[image: name — saved to /workspace/inbox/...]"
 *
 *   Layer 3 — OpenCodeProvider promptAsync file parts
 *     The FilePartInput objects sent alongside the text prompt so OpenCode
 *     can forward them to a vision-capable model (e.g. gemini-2.0-flash).
 *     Also covers AgentQuery.push() forwarding follow-up images.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ChildProcess } from 'child_process';

import { closeSessionDb, getInboundDb, initTestSessionDb } from './db/connection.js';
import type { MessageInRow } from './db/messages-in.js';
import { formatMessages } from './formatter.js';
import { extractImageAttachments } from './poll-loop.js';
import { OpenCodeProvider, _setRuntimeForTest, _setSleepForTest, type SharedRuntime } from './providers/opencode.js';
import type { AttachmentRef, ProviderEvent } from './providers/types.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Minimal MessageInRow stub — only the fields that matter for
 * extractImageAttachments and formatMessages.  Setting channel_type and
 * platform_id to null means originAttr() returns '' without a DB look-up,
 * so these stubs work without a session DB.
 */
function makeRow(content: object, kind = 'chat-sdk'): MessageInRow {
  return {
    id: 'test-msg',
    seq: 2,
    kind,
    timestamp: new Date().toISOString(),
    status: 'pending',
    process_after: null,
    recurrence: null,
    tries: 0,
    trigger: 1,
    platform_id: null,
    channel_type: null,
    thread_id: null,
    content: JSON.stringify(content),
  };
}

/** Attachment content blocks for use in makeRow() */
const PNG_ATTACHMENT = {
  type: 'image',
  name: 'photo.png',
  mimeType: 'image/png',
  size: 12345,
  width: 800,
  height: 600,
  localPath: 'inbox/msg-abc/photo.png',
};

const JPEG_ATTACHMENT = {
  type: 'image',
  name: 'selfie.jpg',
  mimeType: 'image/jpeg',
  size: 9876,
  localPath: 'inbox/msg-abc/selfie.jpg',
};

const PDF_ATTACHMENT = {
  type: 'file',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  size: 88888,
  localPath: 'inbox/msg-abc/report.pdf',
};

// ── SSE stream / OpenCode mock runtime helpers ────────────────────────────────

type SseEvent = { type: string; properties: Record<string, unknown> };

function makeStream(events: SseEvent[]): AsyncGenerator<SseEvent, void, void> {
  return (async function* () {
    for (const ev of events) yield ev;
  })();
}

function idleEvent(sessionId: string): SseEvent {
  return { type: 'session.idle', properties: { sessionID: sessionId } };
}

const PROMPT_OK = { data: {}, error: null };

function makeRuntime(
  sessionIds: string[],
  promptResults: (typeof PROMPT_OK)[],
  stream: AsyncGenerator<SseEvent, void, void>,
): SharedRuntime {
  let sessionIdx = 0;
  let promptIdx = 0;
  return {
    proc: {} as ChildProcess,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: {
      session: {
        create: mock(() => {
          const id = sessionIds[sessionIdx] ?? `sess-auto-${sessionIdx}`;
          sessionIdx++;
          return Promise.resolve({ data: { id }, error: null });
        }),
        promptAsync: mock(() => {
          const result = promptResults[promptIdx] ?? PROMPT_OK;
          promptIdx++;
          return Promise.resolve(result);
        }),
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    stream: stream as AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>,
    streamRelease: () => {},
  };
}

/** Run a query and collect up to `n` result events, calling `onResult` after each. */
async function collectResults(
  provider: OpenCodeProvider,
  input: Parameters<typeof provider.query>[0],
  options: {
    maxResults?: number;
    onResult?: (count: number, q: ReturnType<typeof provider.query>) => void;
  } = {},
): Promise<ProviderEvent[]> {
  const { maxResults = 1, onResult } = options;
  const q = provider.query(input);
  const collected: ProviderEvent[] = [];
  let resultCount = 0;
  for await (const ev of q.events) {
    collected.push(ev);
    if (ev.type === 'result') {
      resultCount++;
      onResult?.(resultCount, q);
      if (resultCount >= maxResults) break;
    }
  }
  return collected;
}

/** Extract the `body.parts` array from the Nth (0-based) promptAsync call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function partsFromCall(promptAsyncMock: any, callIndex = 0): Array<Record<string, unknown>> {
  const calls = promptAsyncMock.mock?.calls ?? [];
  return calls[callIndex]?.[0]?.body?.parts ?? [];
}

// ── Session DB — needed for formatMessages (findByRouting uses getInboundDb) ─

beforeEach(() => {
  initTestSessionDb();
  _setSleepForTest(() => Promise.resolve());
});

afterEach(() => {
  closeSessionDb();
  _setRuntimeForTest(null);
  _setSleepForTest((ms) => new Promise((r) => setTimeout(r, ms)));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 1: extractImageAttachments
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractImageAttachments', () => {
  it('returns [] for an empty message list', () => {
    expect(extractImageAttachments([])).toEqual([]);
  });

  it('returns [] for a message with no attachments field', () => {
    const row = makeRow({ sender: 'Alice', text: 'hello' });
    expect(extractImageAttachments([row])).toEqual([]);
  });

  it('returns [] for a message with an empty attachments array', () => {
    const row = makeRow({ sender: 'Alice', text: 'look', attachments: [] });
    expect(extractImageAttachments([row])).toEqual([]);
  });

  it('extracts an image/png attachment with localPath', () => {
    const row = makeRow({ attachments: [PNG_ATTACHMENT] });
    const result = extractImageAttachments([row]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      localPath: 'inbox/msg-abc/photo.png',
      mimeType: 'image/png',
      name: 'photo.png',
    });
  });

  it('extracts an image/jpeg attachment', () => {
    const row = makeRow({ attachments: [JPEG_ATTACHMENT] });
    const result = extractImageAttachments([row]);
    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe('image/jpeg');
    expect(result[0].name).toBe('selfie.jpg');
  });

  it('skips attachments whose mimeType does not start with "image/"', () => {
    const row = makeRow({ attachments: [PDF_ATTACHMENT] });
    expect(extractImageAttachments([row])).toEqual([]);
  });

  it('skips attachments that have no localPath', () => {
    const urlOnlyAttachment = {
      type: 'image',
      name: 'pic.png',
      mimeType: 'image/png',
      url: 'https://example.com/pic.png',
    };
    const row = makeRow({ attachments: [urlOnlyAttachment] });
    // No localPath → nothing to forward to the container
    expect(extractImageAttachments([row])).toEqual([]);
  });

  it('skips attachments that still have raw data= (pre-host-extraction format)', () => {
    // After host processing, data= is replaced with localPath=.
    // Defensively: if data= survives without localPath, skip it.
    const rawDataAttachment = { type: 'image', name: 'img.png', mimeType: 'image/png', data: 'abc==' };
    const row = makeRow({ attachments: [rawDataAttachment] });
    expect(extractImageAttachments([row])).toEqual([]);
  });

  it('collects multiple images from a single message', () => {
    const row = makeRow({ attachments: [PNG_ATTACHMENT, JPEG_ATTACHMENT] });
    const result = extractImageAttachments([row]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toEqual(['photo.png', 'selfie.jpg']);
  });

  it('skips non-image attachments when mixed with images in the same message', () => {
    const row = makeRow({ attachments: [PNG_ATTACHMENT, PDF_ATTACHMENT, JPEG_ATTACHMENT] });
    const result = extractImageAttachments([row]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.mimeType.startsWith('image/'))).toBe(true);
  });

  it('aggregates images across multiple messages', () => {
    const row1 = makeRow({ sender: 'Alice', text: 'first', attachments: [PNG_ATTACHMENT] });
    const row2 = makeRow({ sender: 'Bob', text: 'second', attachments: [JPEG_ATTACHMENT] });
    const result = extractImageAttachments([row1, row2]);
    expect(result).toHaveLength(2);
    expect(result[0].localPath).toBe('inbox/msg-abc/photo.png');
    expect(result[1].localPath).toBe('inbox/msg-abc/selfie.jpg');
  });

  it('returns undefined for name when the attachment has no name field', () => {
    const noName = { type: 'image', mimeType: 'image/png', localPath: 'inbox/m/x.png' };
    const row = makeRow({ attachments: [noName] });
    const [ref] = extractImageAttachments([row]);
    expect(ref.name).toBeUndefined();
    expect(ref.localPath).toBe('inbox/m/x.png');
    expect(ref.mimeType).toBe('image/png');
  });

  it('silently skips messages whose content is not valid JSON', () => {
    const badRow: MessageInRow = { ...makeRow({}), content: 'not-json-at-all' };
    expect(() => extractImageAttachments([badRow])).not.toThrow();
    expect(extractImageAttachments([badRow])).toEqual([]);
  });

  it('works for any message kind (task, webhook, etc.), not just chat', () => {
    const taskRow = makeRow({ attachments: [PNG_ATTACHMENT] }, 'task');
    const result = extractImageAttachments([taskRow]);
    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe('image/png');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2: Formatter attachment rendering
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatter attachment rendering', () => {
  /** Insert directly into the session DB and retrieve via formatMessages. */
  function insertAndFormat(content: object): string {
    getInboundDb()
      .prepare(
        `INSERT INTO messages_in (id, kind, timestamp, status, content)
         VALUES ('m1', 'chat-sdk', datetime('now'), 'pending', ?)`,
      )
      .run(JSON.stringify(content));
    // Pull via the real DB path so the query chain is exercised
    const [row] = getInboundDb().prepare("SELECT * FROM messages_in WHERE id = 'm1'").all() as MessageInRow[];
    return formatMessages([row]);
  }

  it('renders an image attachment with localPath as "[image: name — saved to /workspace/...]"', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'look at this',
      attachments: [PNG_ATTACHMENT],
    });
    expect(out).toContain('[image: photo.png — saved to /workspace/inbox/msg-abc/photo.png]');
  });

  it('prefixes the localPath with /workspace/ in the output', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'hi',
      attachments: [{ type: 'image', name: 'x.png', mimeType: 'image/png', localPath: 'inbox/id/x.png' }],
    });
    expect(out).toContain('/workspace/inbox/id/x.png');
    expect(out).not.toContain('/workspace//workspace/');
  });

  it('uses the attachment "type" field as the label prefix', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'hi',
      attachments: [PDF_ATTACHMENT],
    });
    // PDF has type='file', not type='image'
    expect(out).toContain('[file: report.pdf — saved to /workspace/inbox/msg-abc/report.pdf]');
  });

  it('renders url-only attachments (no localPath) as "[image: name (url)]"', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'hi',
      attachments: [
        { type: 'image', name: 'remote.png', mimeType: 'image/png', url: 'https://cdn.example.com/img.png' },
      ],
    });
    expect(out).toContain('[image: remote.png (https://cdn.example.com/img.png)]');
  });

  it('renders bare attachments (no localPath, no url) as "[image: name]"', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'hi',
      attachments: [{ type: 'image', name: 'bare.png', mimeType: 'image/png' }],
    });
    expect(out).toContain('[image: bare.png]');
    expect(out).not.toContain('(');
    expect(out).not.toContain('/workspace/');
  });

  it('renders multiple attachments as multiple lines inside the message block', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'two pics',
      attachments: [PNG_ATTACHMENT, JPEG_ATTACHMENT],
    });
    expect(out).toContain('[image: photo.png — saved to /workspace/inbox/msg-abc/photo.png]');
    expect(out).toContain('[image: selfie.jpg — saved to /workspace/inbox/msg-abc/selfie.jpg]');
  });

  it('appends attachments after the message text content, inside the <message> block', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'the actual text',
      attachments: [PNG_ATTACHMENT],
    });
    const textIdx = out.indexOf('the actual text');
    const attachIdx = out.indexOf('[image:');
    const closeIdx = out.indexOf('</message>');
    expect(textIdx).toBeGreaterThan(0);
    expect(attachIdx).toBeGreaterThan(textIdx);
    expect(closeIdx).toBeGreaterThan(attachIdx);
  });

  it('XML-escapes special characters in attachment names', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'hi',
      attachments: [{ type: 'image', name: '<script>.png', mimeType: 'image/png', localPath: 'inbox/m/safe.png' }],
    });
    expect(out).toContain('&lt;script&gt;.png');
    expect(out).not.toContain('<script>');
  });

  it('XML-escapes special characters in localPath', () => {
    const out = insertAndFormat({
      sender: 'Mathias',
      text: 'hi',
      attachments: [{ type: 'image', name: 'ok.png', mimeType: 'image/png', localPath: 'inbox/a&b/ok.png' }],
    });
    expect(out).toContain('/workspace/inbox/a&amp;b/ok.png');
  });

  it('produces no attachment annotation when attachments array is absent', () => {
    const out = insertAndFormat({ sender: 'Mathias', text: 'plain text only' });
    expect(out).not.toContain('[image:');
    expect(out).not.toContain('[file:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 3: OpenCodeProvider promptAsync file parts
// ═══════════════════════════════════════════════════════════════════════════════

describe('OpenCodeProvider — file parts in promptAsync', () => {
  it('sends only the text part when the query has no attachments', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    await collectResults(new OpenCodeProvider(), { prompt: 'hello', cwd: '/test' });

    const parts = partsFromCall(rt.client.session.promptAsync);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text' });
  });

  it('adds a FilePartInput for a single image attachment', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [
      { localPath: 'inbox/msg-1/photo.png', mimeType: 'image/png', name: 'photo.png' },
    ];
    await collectResults(new OpenCodeProvider(), { prompt: 'describe this', cwd: '/test', attachments });

    const parts = partsFromCall(rt.client.session.promptAsync);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: 'text', text: 'describe this' });
    expect(parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      filename: 'photo.png',
      url: 'file:///workspace/inbox/msg-1/photo.png',
    });
  });

  it('builds the file:// URL by prepending /workspace/ to localPath', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [
      { localPath: 'inbox/abc:def/screenshot.jpg', mimeType: 'image/jpeg', name: 'screenshot.jpg' },
    ];
    await collectResults(new OpenCodeProvider(), { prompt: 'what is this?', cwd: '/test', attachments });

    const filePart = partsFromCall(rt.client.session.promptAsync)[1];
    expect(filePart.url).toBe('file:///workspace/inbox/abc:def/screenshot.jpg');
  });

  it('adds one FilePartInput per image when multiple attachments are present', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [
      { localPath: 'inbox/m/a.png', mimeType: 'image/png', name: 'a.png' },
      { localPath: 'inbox/m/b.jpg', mimeType: 'image/jpeg', name: 'b.jpg' },
      { localPath: 'inbox/m/c.gif', mimeType: 'image/gif', name: 'c.gif' },
    ];
    await collectResults(new OpenCodeProvider(), { prompt: 'compare these', cwd: '/test', attachments });

    const parts = partsFromCall(rt.client.session.promptAsync);
    expect(parts).toHaveLength(4); // 1 text + 3 files
    const fileParts = parts.slice(1);
    expect(fileParts.map((p) => p.mime)).toEqual(['image/png', 'image/jpeg', 'image/gif']);
  });

  it('skips non-image/* MIME types (e.g. PDF) even when present in attachments', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [
      { localPath: 'inbox/m/doc.pdf', mimeType: 'application/pdf', name: 'doc.pdf' },
      { localPath: 'inbox/m/photo.png', mimeType: 'image/png', name: 'photo.png' },
    ];
    await collectResults(new OpenCodeProvider(), { prompt: 'look', cwd: '/test', attachments });

    const parts = partsFromCall(rt.client.session.promptAsync);
    // PDF must not appear; only the PNG file part
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ mime: 'image/png' });
  });

  it('uses the AttachmentRef name as the filename in the FilePartInput', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [
      { localPath: 'inbox/m/image.png', mimeType: 'image/png', name: 'my-screenshot.png' },
    ];
    await collectResults(new OpenCodeProvider(), { prompt: 'hi', cwd: '/test', attachments });

    const filePart = partsFromCall(rt.client.session.promptAsync)[1];
    expect(filePart.filename).toBe('my-screenshot.png');
  });

  it('omits filename from the part when the AttachmentRef has no name', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [{ localPath: 'inbox/m/image.png', mimeType: 'image/png' }];
    await collectResults(new OpenCodeProvider(), { prompt: 'hi', cwd: '/test', attachments });

    const filePart = partsFromCall(rt.client.session.promptAsync)[1];
    expect(filePart.filename).toBeUndefined();
  });

  it('still sends text-only part when attachments array is explicitly empty', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    await collectResults(new OpenCodeProvider(), { prompt: 'hi', cwd: '/test', attachments: [] });

    const parts = partsFromCall(rt.client.session.promptAsync);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text' });
  });

  it('passes image parts correctly even when using a stored continuation', async () => {
    const stream = makeStream([idleEvent('s1')]);
    const rt = makeRuntime(['s1'], [PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const attachments: AttachmentRef[] = [{ localPath: 'inbox/m/img.png', mimeType: 'image/png', name: 'img.png' }];
    // continuation means the session is reused, not created fresh
    const provider = new OpenCodeProvider();
    // Manually set a prior session id (simulates a resumed session)
    provider.query({ prompt: 'prior turn', cwd: '/test' }); // creates s1

    // Reset stream / runtime for the actual test turn
    const stream2 = makeStream([idleEvent('s1')]);
    const rt2 = makeRuntime([], [PROMPT_OK], stream2);
    _setRuntimeForTest(rt2);

    await collectResults(provider, {
      prompt: 'look at this',
      cwd: '/test',
      continuation: 's1',
      attachments,
    });

    const parts = partsFromCall(rt2.client.session.promptAsync);
    expect(parts.some((p) => p.type === 'file')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 3b: AgentQuery.push() with attachments (follow-up turns)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The drain window (drainIdleWindow) reads one extra event per turn after
 * session.idle to detect "genuinely done" (a second idle for the same session).
 * For N turns, the stream therefore needs N*2 idle events:
 *   odd-indexed  (0, 2, 4, …) → consumed by the main turn loop
 *   even-indexed (1, 3, 5, …) → consumed by drainIdleWindow as the stop signal
 */
function idleEventsForTurns(n: number, sessionId: string): SseEvent[] {
  return Array.from({ length: n * 2 }, () => idleEvent(sessionId));
}

describe('AgentQuery.push() with image attachments', () => {
  it('sends file parts on the second turn when push() carries attachments', async () => {
    // Two turns → 4 idle events (2 per turn: main loop + drain window)
    const stream = makeStream(idleEventsForTurns(2, 's1'));
    const rt = makeRuntime(['s1'], [PROMPT_OK, PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const followUpAtt: AttachmentRef[] = [{ localPath: 'inbox/msg-2/new.png', mimeType: 'image/png', name: 'new.png' }];

    const resultCount = 0;
    await collectResults(
      new OpenCodeProvider(),
      { prompt: 'hello', cwd: '/test' },
      {
        maxResults: 2,
        onResult: (n, q) => {
          if (n === 1) q.push('now look at this image', followUpAtt);
        },
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promptMock = rt.client.session.promptAsync as any;
    expect(promptMock.mock.calls).toHaveLength(2);

    // First turn: text-only
    const firstParts = partsFromCall(promptMock, 0);
    expect(firstParts).toHaveLength(1);
    expect(firstParts[0]).toMatchObject({ type: 'text' });

    // Second turn: text + file part
    const secondParts = partsFromCall(promptMock, 1);
    expect(secondParts).toHaveLength(2);
    expect(secondParts[0]).toMatchObject({ type: 'text' });
    expect(secondParts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      filename: 'new.png',
      url: 'file:///workspace/inbox/msg-2/new.png',
    });
    // Ensure resultCount is used (lint)
    void resultCount;
  });

  it('sends text-only on the second turn when push() has no attachments', async () => {
    const stream = makeStream(idleEventsForTurns(2, 's1'));
    const rt = makeRuntime(['s1'], [PROMPT_OK, PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    await collectResults(
      new OpenCodeProvider(),
      { prompt: 'hello', cwd: '/test' },
      {
        maxResults: 2,
        onResult: (n, q) => {
          if (n === 1) q.push('follow-up without image');
        },
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promptMock = rt.client.session.promptAsync as any;
    const secondParts = partsFromCall(promptMock, 1);
    expect(secondParts).toHaveLength(1);
    expect(secondParts[0]).toMatchObject({ type: 'text' });
  });

  it('can carry different images on each of multiple sequential push() calls', async () => {
    // Three turns → 6 idle events
    const stream = makeStream(idleEventsForTurns(3, 's1'));
    const rt = makeRuntime(['s1'], [PROMPT_OK, PROMPT_OK, PROMPT_OK], stream);
    _setRuntimeForTest(rt);

    const att1: AttachmentRef[] = [{ localPath: 'inbox/m1/a.png', mimeType: 'image/png', name: 'a.png' }];
    const att2: AttachmentRef[] = [{ localPath: 'inbox/m2/b.jpg', mimeType: 'image/jpeg', name: 'b.jpg' }];

    let call = 0;
    await collectResults(
      new OpenCodeProvider(),
      { prompt: 'first', cwd: '/test' },
      {
        maxResults: 3,
        onResult: (n, q) => {
          call++;
          if (n === 1) q.push('second', att1);
          if (n === 2) q.push('third', att2);
        },
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promptMock = rt.client.session.promptAsync as any;
    expect(promptMock.mock.calls).toHaveLength(3);

    expect(partsFromCall(promptMock, 0)).toHaveLength(1); // first: text only
    expect(partsFromCall(promptMock, 1)[1]).toMatchObject({ mime: 'image/png', url: expect.stringContaining('a.png') });
    expect(partsFromCall(promptMock, 2)[1]).toMatchObject({
      mime: 'image/jpeg',
      url: expect.stringContaining('b.jpg'),
    });
    void call;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Type-level sanity: AttachmentRef, QueryInput, AgentQuery shapes
// ═══════════════════════════════════════════════════════════════════════════════

describe('AttachmentRef and QueryInput type shapes', () => {
  it('QueryInput.attachments is optional (absent → no error)', () => {
    // This is a compile-time check expressed as a runtime no-op.
    // If the type is wrong, bun will fail to parse this file.
    const input: Parameters<OpenCodeProvider['query']>[0] = {
      prompt: 'hi',
      cwd: '/test',
      // no attachments field — must be optional
    };
    expect(input.prompt).toBe('hi');
    expect(input.attachments).toBeUndefined();
  });

  it('QueryInput.attachments accepts an AttachmentRef[]', () => {
    const atts: AttachmentRef[] = [{ localPath: 'inbox/m/x.png', mimeType: 'image/png', name: 'x.png' }];
    const input: Parameters<OpenCodeProvider['query']>[0] = {
      prompt: 'hi',
      cwd: '/test',
      attachments: atts,
    };
    expect(input.attachments).toHaveLength(1);
  });

  it('AgentQuery.push() accepts a single string (second arg is optional)', () => {
    const stream = makeStream([idleEvent('s1')]);
    _setRuntimeForTest(makeRuntime(['s1'], [PROMPT_OK], stream));

    const q = new OpenCodeProvider().query({ prompt: 'hi', cwd: '/test' });
    // Should compile and run without error — second arg is optional
    expect(() => q.push('follow-up')).not.toThrow();
  });

  it('AgentQuery.push() accepts a string + AttachmentRef[] second argument', () => {
    const stream = makeStream([idleEvent('s1')]);
    _setRuntimeForTest(makeRuntime(['s1'], [PROMPT_OK], stream));

    const q = new OpenCodeProvider().query({ prompt: 'hi', cwd: '/test' });
    const atts: AttachmentRef[] = [{ localPath: 'inbox/m/y.jpg', mimeType: 'image/jpeg' }];
    expect(() => q.push('follow-up', atts)).not.toThrow();
  });
});
