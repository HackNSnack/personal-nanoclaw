/**
 * Slack channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 *
 * Socket Mode ping timeouts:
 *   @slack/socket-mode defaults clientPingTimeout to 5000ms and
 *   serverPingTimeout to the same, which is too tight for Slack's
 *   infrastructure under load. We patch the SocketModeClient post-construction
 *   via internal property access since Bolt's AppOptions doesn't expose these.
 *   References:
 *     - https://github.com/slackapi/node-slack-sdk/issues/1425
 *     - https://github.com/slackapi/node-slack-sdk/pull/1835
 */
import { createSlackAdapter } from '@chat-adapter/slack';

import { readEnvFile } from '../env.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

/** Socket Mode client ping timeout in ms (default: 5000 — too tight). */
const CLIENT_PING_TIMEOUT_MS = 15_000;
/** Socket Mode server ping timeout in ms (default matches clientPingTimeout). */
const SERVER_PING_TIMEOUT_MS = 30_000;

registerChannelAdapter('slack', {
  factory: () => {
    const env = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET']);
    if (!env.SLACK_BOT_TOKEN) return null;

    // Prefer Socket Mode (outbound WebSocket — no public URL required) when
    // SLACK_APP_TOKEN (xapp-...) is present in the environment. This is set
    // via EnvironmentFile in the systemd service unit. Falls back to webhook
    // mode when no app token is available (requires a publicly reachable URL
    // and the signing secret for request verification).
    const appToken = process.env.SLACK_APP_TOKEN;
    const slackAdapter = appToken
      ? createSlackAdapter({ botToken: env.SLACK_BOT_TOKEN, mode: 'socket', appToken })
      : createSlackAdapter({ botToken: env.SLACK_BOT_TOKEN, signingSecret: env.SLACK_SIGNING_SECRET });

    // Patch Socket Mode ping timeouts post-construction.
    // Bolt's AppOptions doesn't expose these; we reach into the SocketModeClient
    // directly. Non-fatal on failure — falls back to SDK defaults silently.
    if (appToken) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = (slackAdapter as any).app?.receiver?.client;
        if (client && typeof client === 'object') {
          const c = client as Record<string, unknown>;
          if ('clientPingTimeout' in c) c.clientPingTimeout = CLIENT_PING_TIMEOUT_MS;
          if ('serverPingTimeout' in c) c.serverPingTimeout = SERVER_PING_TIMEOUT_MS;
        }
      } catch {
        // Non-fatal: if internal structure changed, use SDK defaults
      }
    }

    const bridge = createChatSdkBridge({ adapter: slackAdapter, concurrency: 'concurrent', supportsThreads: true });
    bridge.resolveChannelName = async (platformId: string) => {
      try {
        const info = await slackAdapter.fetchThread(platformId);
        return (info as { channelName?: string }).channelName ?? null;
      } catch {
        return null;
      }
    };
    return bridge;
  },
});
