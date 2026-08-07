/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync, execFile as execFileCb } from 'child_process';
import { promisify } from 'node:util';
import os from 'os';

import { CONTAINER_INSTALL_LABEL } from './config.js';
import { log } from './log.js';

const execFile = promisify(execFileCb);

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`, { stdio: 'pipe' });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    log.debug('Container runtime already running');
  } catch (err) {
    log.error('Failed to reach container runtime', { err });
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: Container runtime failed to start                      ║');
    console.error('║                                                                ║');
    console.error('║  Agents cannot run without a container runtime. To fix:        ║');
    console.error('║  1. Ensure Docker is installed and running                     ║');
    console.error('║  2. Run: docker info                                           ║');
    console.error('║  3. Restart NanoClaw                                           ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    throw new Error('Container runtime is required but failed to start', {
      cause: err,
    });
  }
}

/**
 * Kill orphaned NanoClaw containers from THIS install's previous runs.
 *
 * Scoped by label `nanoclaw-install=<slug>` so a crash-looping peer install
 * cannot reap our containers, and we cannot reap theirs. The label is
 * stamped onto every container at spawn time — see container-runner.ts.
 *
 * Async + parallel: the previous sync `execSync` serial loop blocked the
 * event loop for N × stop-timeout at startup. Now each orphan is stopped
 * concurrently via `execFile` (non-blocking). Containers are `--rm` so stop
 * auto-removes them — no separate `rm -f` needed.
 */
export async function cleanupOrphans(): Promise<void> {
  try {
    const { stdout } = await execFile(
      CONTAINER_RUNTIME_BIN,
      ['ps', '--filter', `label=${CONTAINER_INSTALL_LABEL}`, '--format', '{{.Names}}'],
      { encoding: 'utf-8' },
    );
    const orphans = stdout.trim().split('\n').filter(Boolean);
    if (orphans.length === 0) return;
    await Promise.all(
      orphans.map(async (name) => {
        // Skip names that don't match the container-name charset — `ps --format`
        // output is names we stamped, but guard against a malformed row
        // reaching the exec argv.
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) return;
        try {
          await execFile(CONTAINER_RUNTIME_BIN, ['stop', '-t', '1', name], { encoding: 'utf-8' });
        } catch {
          /* already stopped */
        }
      }),
    );
    log.info('Stopped orphaned containers', { count: orphans.length, names: orphans });
  } catch (err) {
    log.warn('Failed to clean up orphaned containers', { err });
  }
}
