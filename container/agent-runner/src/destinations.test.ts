import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { closeSessionDb, getInboundDb, initTestSessionDb } from './db/connection.js';
import { buildSystemPromptAddendum } from './destinations.js';

beforeEach(() => {
  initTestSessionDb();
});

afterEach(() => {
  closeSessionDb();
});

function seedDestination(name: string, displayName: string, channelType: string, platformId: string): void {
  getInboundDb()
    .prepare(
      `INSERT INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
       VALUES (?, ?, 'channel', ?, ?, NULL)`,
    )
    .run(name, displayName, channelType, platformId);
}

describe('buildSystemPromptAddendum — multi-destination routing guidance', () => {
  it('includes default-routing nudge when there are >1 destinations', () => {
    seedDestination('casa', 'Casa', 'whatsapp', 'group-1@g.us');
    seedDestination('whatsapp-mg-17780', 'whatsapp-mg-17780', 'whatsapp', 'phone-2@s.whatsapp.net');

    const prompt = buildSystemPromptAddendum('Casa');

    expect(prompt).toContain('default to addressing the destination it came `from`');
    expect(prompt).toContain('from="name"');
    expect(prompt).toContain('`casa`');
    expect(prompt).toContain('`whatsapp-mg-17780`');
  });

  it('describes message wrapping for a single destination', () => {
    seedDestination('casa', 'Casa', 'whatsapp', 'group-1@g.us');

    const prompt = buildSystemPromptAddendum('Casa');

    expect(prompt).toContain('Wrap each delivered message');
    expect(prompt).toContain('<message to="name">');
    expect(prompt).toContain('`casa`');
  });

  it('handles the no-destination case without crashing', () => {
    const prompt = buildSystemPromptAddendum('Casa');

    expect(prompt).toContain('no configured destinations');
    expect(prompt).not.toContain('default to addressing');
  });

  it('includes default-routing and wrapping instructions for single destination', () => {
    seedDestination('casa', 'Casa', 'whatsapp', 'group-1@g.us');

    const prompt = buildSystemPromptAddendum('Casa');

    expect(prompt).toContain('Wrap each delivered message');
    expect(prompt).toContain('<message to="name">');
    expect(prompt).toContain('default to addressing the destination it came `from`');
    expect(prompt).toContain('`casa`');
  });
});

describe('buildSystemPromptAddendum — opencode provider (tool-call delivery)', () => {
  it('mandates send_message as the sole delivery path, with no <message> block or <finish/> tag', () => {
    seedDestination('slack', 'Slack', 'slack', 'C-123');

    const prompt = buildSystemPromptAddendum('Andy', 'opencode');

    expect(prompt).toContain('MANDATORY');
    expect(prompt).toContain('send_message');
    expect(prompt).toContain('<internal>');
    // The Claude-path instruction to WRAP content in <message> blocks must
    // be absent — OpenCode's only mention of <message> is the "NEVER put
    // your answer" warning, not an instruction to use it.
    expect(prompt).not.toContain('Wrap each delivered message');
    expect(prompt).not.toContain('<finish/>');
    expect(prompt).toContain('`slack`');
  });

  it('places the delivery rule before the destination list', () => {
    seedDestination('slack', 'Slack', 'slack', 'C-123');

    const prompt = buildSystemPromptAddendum('Andy', 'opencode');

    const ruleIdx = prompt.indexOf('MANDATORY');
    const destIdx = prompt.indexOf('Your destination is');
    expect(ruleIdx).toBeGreaterThan(-1);
    expect(destIdx).toBeGreaterThan(-1);
    expect(ruleIdx).toBeLessThan(destIdx);
  });

  it('tells the model about the forced follow-up completion and the DONE sentinel', () => {
    seedDestination('slack', 'Slack', 'slack', 'C-123');

    const prompt = buildSystemPromptAddendum('Andy', 'opencode');

    expect(prompt).toContain('automatic');
    expect(prompt).toContain('reply with exactly `DONE`');
  });
});
