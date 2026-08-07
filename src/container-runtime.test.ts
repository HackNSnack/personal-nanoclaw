import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock log
vi.mock('./log.js', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock child_process — store the mock fns so tests can configure them.
// `cleanupOrphans` uses promisified `execFile` (callback-style under the hood);
// the mock must therefore call the trailing callback, not return a Promise.
const mockExecSync = vi.fn();
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...a: unknown[]) => mockExecSync(...a),
  execFile: (...a: unknown[]) => mockExecFile(...a),
}));

import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
} from './container-runtime.js';
import { CONTAINER_INSTALL_LABEL } from './config.js';
import { log } from './log.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default execFile: no orphans (empty ps output), stop calls succeed.
  mockExecFile.mockImplementation((_file: string, argv: string[], _opts: unknown, cb: Function) => {
    if (typeof cb !== 'function') return;
    if (argv[0] === 'ps') cb(null, { stdout: '', stderr: '' });
    else cb(null, { stdout: '', stderr: '' });
  });
});

// Helper: make the `ps` call return a list of orphan names; stop calls succeed.
function mockPsOrphans(names: string): void {
  mockExecFile.mockImplementation((_file: string, argv: string[], _opts: unknown, cb: Function) => {
    if (typeof cb !== 'function') return;
    if (argv[0] === 'ps') cb(null, { stdout: names, stderr: '' });
    else cb(null, { stdout: '', stderr: '' });
  });
}

// --- Pure functions ---

describe('readonlyMountArgs', () => {
  it('returns -v flag with :ro suffix', () => {
    const args = readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
  });
});

describe('stopContainer', () => {
  it('calls docker stop for valid container names', () => {
    stopContainer('nanoclaw-test-123');
    expect(mockExecSync).toHaveBeenCalledWith(`${CONTAINER_RUNTIME_BIN} stop -t 1 nanoclaw-test-123`, {
      stdio: 'pipe',
    });
  });

  it('rejects names with shell metacharacters', () => {
    expect(() => stopContainer('foo; rm -rf /')).toThrow('Invalid container name');
    expect(() => stopContainer('foo$(whoami)')).toThrow('Invalid container name');
    expect(() => stopContainer('foo`id`')).toThrow('Invalid container name');
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

// --- ensureContainerRuntimeRunning ---

describe('ensureContainerRuntimeRunning', () => {
  it('does nothing when runtime is already running', () => {
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    expect(log.debug).toHaveBeenCalledWith('Container runtime already running');
  });

  it('throws when docker info fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('Cannot connect to the Docker daemon');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow('Container runtime is required but failed to start');
    expect(log.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans ---

describe('cleanupOrphans', () => {
  it('filters ps by the install label so peers are not reaped', async () => {
    await cleanupOrphans();

    expect(mockExecFile).toHaveBeenCalledWith(
      CONTAINER_RUNTIME_BIN,
      ['ps', '--filter', `label=${CONTAINER_INSTALL_LABEL}`, '--format', '{{.Names}}'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('stops orphaned nanoclaw containers in parallel', async () => {
    mockPsOrphans('nanoclaw-group1-111\nnanoclaw-group2-222\n');

    await cleanupOrphans();

    // ps + 2 stop calls
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      CONTAINER_RUNTIME_BIN,
      ['stop', '-t', '1', 'nanoclaw-group1-111'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockExecFile).toHaveBeenNthCalledWith(
      3,
      CONTAINER_RUNTIME_BIN,
      ['stop', '-t', '1', 'nanoclaw-group2-222'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(log.info).toHaveBeenCalledWith('Stopped orphaned containers', {
      count: 2,
      names: ['nanoclaw-group1-111', 'nanoclaw-group2-222'],
    });
  });

  it('does nothing when no orphans exist', async () => {
    await cleanupOrphans();

    // only the ps call runs
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('warns and continues when ps fails', async () => {
    mockExecFile.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Function) => {
      cb(new Error('docker not available'));
    });

    await cleanupOrphans(); // should not throw

    expect(log.warn).toHaveBeenCalledWith(
      'Failed to clean up orphaned containers',
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  it('continues stopping remaining containers when one stop fails', async () => {
    mockExecFile.mockImplementation((_f: string, argv: string[], _o: unknown, cb: Function) => {
      if (argv[0] === 'ps') return cb(null, { stdout: 'nanoclaw-a-1\nnanoclaw-b-2\n', stderr: '' });
      if (argv[2] === 'nanoclaw-a-1') return cb(new Error('already stopped'));
      cb(null, { stdout: '', stderr: '' });
    });

    await cleanupOrphans(); // should not throw

    expect(mockExecFile).toHaveBeenCalledTimes(3);
    expect(log.info).toHaveBeenCalledWith('Stopped orphaned containers', {
      count: 2,
      names: ['nanoclaw-a-1', 'nanoclaw-b-2'],
    });
  });
});
