import type { Migration } from './index.js';

/**
 * Composite index on sessions(status, last_active).
 *
 * The host sweep and delivery sweep both run `WHERE status = 'active'` every
 * tick. On a mature install with many inactive/historical sessions, that was
 * a full table scan — Ardoq cited a real VM kill from the scan under load.
 * status is the leading column so the index turns the scan into an index range
 * over only active rows, and last_active is available as a second column for
 * any future windowed query without a separate index.
 *
 * (We intentionally do NOT window `getActiveSessions` itself here: the host
 * sweep drives scheduled-task due-message wake through it, and a time window
 * would skip long-idle sessions and break scheduled tasks. The index delivers
 * the scan-reduction win without that regression.)
 */
export const migration019: Migration = {
  version: 19,
  name: 'sessions-last-active-index',
  up(db) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(status, last_active);`);
  },
};