import { beforeEach, afterEach, describe, expect, test } from 'bun:test';

import { initOutboundOnlyTestDb, closeOutboundTestDb } from './db/connection.js';
import { clearContinuation, getContinuation, setContinuation } from './db/session-state.js';
import { processQuery } from './poll-loop.js';
import type { AgentQuery, ProviderEvent } from './providers/types.js';

/**
 * Heartbeat-silence watchdog tests.
 *
 * Lives in its own file (not poll-loop.test.ts) and uses an OUTBOUND-ONLY test
 * DB: these tests never read inbound (the poll ticker is cleared at 50ms before
 * its first 500ms tick), and swapping the shared `_inbound` singleton mid-suite
 * would race a concurrent `runPollLoop` test. Touching only `_outbound` keeps
 * them isolated. See initOutboundOnlyTestDb.
 *
 * processQuery's event loop hangs forever on a wedged query (the async
 * iterator never resolves), so these tests do NOT await it — they
 * fire-and-forget and poll for the watchdog's deferred exit(76) callback,
 * exactly as a real exit would reap the process.
 *
 * processQuery carries extra params (onExchangeComplete, initialPrompt,
 * initialContinuation) ahead of the watchdog seam, so the calls thread
 * undefined/'' through them to reach watchdogMs/exitProcess/getInFlight/touch/
 * onWedge/isColdResume/resumeGraceMs.
 */

beforeEach(() => {
  initOutboundOnlyTestDb();
});

afterEach(() => {
  closeOutboundTestDb();
});

/**
 * Build a query that emits `events` on a `gapMs` cadence, then either ends
 * (hangAfter=false) or hangs forever (hangAfter=true). The hang is resolvable
 * via abort()/end() so each test can release the otherwise-forever-pending
 * for-await (no leak into the shared event loop).
 */
function makeHangingQuery(opts: { events: ProviderEvent[]; gapMs: number; hangAfter: boolean }): AgentQuery {
  const { events, gapMs, hangAfter } = opts;
  let releaseHang: (() => void) | null = null;
  async function* stream(): AsyncGenerator<ProviderEvent> {
    for (const e of events) {
      await new Promise((r) => setTimeout(r, gapMs));
      yield e;
    }
    if (hangAfter) await new Promise<void>((resolve) => { releaseHang = resolve; });
  }
  return {
    push() {},
    end() { releaseHang?.(); },
    abort() { releaseHang?.(); },
    events: stream(),
  };
}

const routing = {
  platformId: 'chan-1',
  channelType: 'discord',
  threadId: null,
  inReplyTo: 'm1',
};

describe('heartbeat-silence watchdog', () => {
  test('fires exit(76) + onWedge(postInit=false) on a whole-turn-silent cold resume', async () => {
    const query = makeHangingQuery({ events: [], gapMs: 10, hangAfter: true });

    let exitCode: number | undefined;
    const exitSpy = (code: number) => {
      exitCode = code;
    };
    const wedged: Array<{ provider: string; continuation: string; postInit: boolean }> = [];
    const onWedge = (provider: string, continuation: string, postInit: boolean) => {
      wedged.push({ provider, continuation, postInit });
    };

    void processQuery(
      query,
      routing,
      ['m1'],
      'mock',
      undefined,
      '',
      'sess-wedge',
      50,
      exitSpy,
      () => null,
      () => {},
      onWedge,
      true,
      0,
    );

    await new Promise((r) => setTimeout(r, 400));
    expect(exitCode).toBe(76);
    expect(wedged).toEqual([{ provider: 'mock', continuation: 'sess-wedge', postInit: false }]);
    query.abort();
    await new Promise((r) => setTimeout(r, 50));
  });

  test('strikes onWedge(postInit=true) when init fires then the turn wedges', async () => {
    const query = makeHangingQuery({
      events: [{ type: 'init', continuation: 'init-sess' }],
      gapMs: 10,
      hangAfter: true,
    });

    let exitCode: number | undefined;
    const exitSpy = (code: number) => {
      exitCode = code;
    };
    const wedged: Array<{ provider: string; continuation: string; postInit: boolean }> = [];
    const onWedge = (provider: string, continuation: string, postInit: boolean) => {
      wedged.push({ provider, continuation, postInit });
    };

    void processQuery(
      query,
      routing,
      ['m1'],
      'mock',
      undefined,
      '',
      'resumed-sess',
      50,
      exitSpy,
      () => null,
      () => {},
      onWedge,
      true,
      0,
    );

    await new Promise((r) => setTimeout(r, 400));
    expect(exitCode).toBe(76);
    expect(wedged).toEqual([{ provider: 'mock', continuation: 'resumed-sess', postInit: true }]);
    query.abort();
    await new Promise((r) => setTimeout(r, 50));
  });

  test('second silent cold-resume wedge clears the poisoned continuation (strike-limit self-heal)', async () => {
    setContinuation('mock', 'conv-poison');

    const wedgeQueries: AgentQuery[] = [];
    const fireWedge = () => {
      const q = makeHangingQuery({ events: [], gapMs: 10, hangAfter: true });
      wedgeQueries.push(q);
      void processQuery(
        q,
        routing,
        ['m1'],
        'mock',
        undefined,
        '',
        'conv-poison',
        50,
        () => {},
        () => null,
        () => {},
        undefined, // default onWedge → defaultOnWedge (real strike counter)
        true,
        0,
      );
    };

    fireWedge();
    await new Promise((r) => setTimeout(r, 300));
    expect(getContinuation('mock')).toBe('conv-poison');

    fireWedge();
    await new Promise((r) => setTimeout(r, 300));
    expect(getContinuation('mock')).toBeUndefined();

    clearContinuation('mock');
    for (const q of wedgeQueries) q.abort();
    await new Promise((r) => setTimeout(r, 50));
  });
});