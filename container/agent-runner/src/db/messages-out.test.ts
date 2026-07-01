import { beforeEach, describe, expect, test } from 'bun:test';

import { initTestSessionDb } from './connection.js';
import { getMaxOutboundSeq, hasMatchingOutboundSince, writeMessageOut } from './messages-out.js';

beforeEach(() => {
  initTestSessionDb();
});

describe('getMaxOutboundSeq', () => {
  test('returns 0 when outbound.db is empty', () => {
    expect(getMaxOutboundSeq()).toBe(0);
  });

  test('advances as rows are written', () => {
    const before = getMaxOutboundSeq();
    const seq = writeMessageOut({ id: 'm1', kind: 'chat', content: JSON.stringify({ text: 'hi' }) });
    expect(getMaxOutboundSeq()).toBe(seq);
    expect(seq).toBeGreaterThan(before);
  });
});

describe('hasMatchingOutboundSince', () => {
  test('finds a verbatim match written after the baseline', () => {
    const baseline = getMaxOutboundSeq();
    writeMessageOut({ id: 'm1', kind: 'chat', content: JSON.stringify({ text: 'Hi Mathias! How can I help?' }) });
    expect(hasMatchingOutboundSince('Hi Mathias! How can I help?', baseline)).toBe(true);
  });

  test('normalizes whitespace before comparing (trim + collapse)', () => {
    const baseline = getMaxOutboundSeq();
    writeMessageOut({ id: 'm1', kind: 'chat', content: JSON.stringify({ text: 'Hi Mathias!   How can I help?' }) });
    expect(hasMatchingOutboundSince('  Hi Mathias! How can I help?\n', baseline)).toBe(true);
  });

  test('does not match content written before the baseline', () => {
    writeMessageOut({ id: 'm1', kind: 'chat', content: JSON.stringify({ text: 'old message' }) });
    const baseline = getMaxOutboundSeq();
    expect(hasMatchingOutboundSince('old message', baseline)).toBe(false);
  });

  test('does not match distinct content (no false positive on a genuinely new message)', () => {
    const baseline = getMaxOutboundSeq();
    writeMessageOut({ id: 'm1', kind: 'chat', content: JSON.stringify({ text: 'Looking it up' }) });
    expect(hasMatchingOutboundSince('The answer is 42', baseline)).toBe(false);
  });

  test('returns false for empty/whitespace-only text', () => {
    const baseline = getMaxOutboundSeq();
    writeMessageOut({ id: 'm1', kind: 'chat', content: JSON.stringify({ text: '' }) });
    expect(hasMatchingOutboundSince('   ', baseline)).toBe(false);
  });

  test('ignores rows with unparseable content instead of throwing', () => {
    const baseline = getMaxOutboundSeq();
    writeMessageOut({ id: 'm1', kind: 'chat', content: 'not json' });
    expect(hasMatchingOutboundSince('not json', baseline)).toBe(false);
  });
});
