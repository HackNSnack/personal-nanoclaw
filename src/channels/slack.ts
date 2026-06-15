/**
 * Slack channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 */
import { createSlackAdapter } from '@chat-adapter/slack';

import { readEnvFile } from '../env.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

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

    // Intercept socketClient assignment to inject ping timeout values into
    // SocketModeClient before start() reads them. The adapter's startSocketMode()
    // creates new SocketModeClient({appToken}) with defaults only (5s/30s), then
    // immediately calls .start() — which reads this.clientPingTimeoutMS to create
    // SlackWebSocket. By trapping the setter we set our values between the two calls.
    //
    // SocketModeClient stores clientPingTimeout (constructor option) as
    // this.clientPingTimeoutMS, which SlackWebSocket constructor reads as
    // clientPingTimeoutMS. Property names must match at the instance level.
    const cpt = Number(process.env.SLACK_CLIENT_PING_TIMEOUT_MS) || 15_000;
    const spt = Number(process.env.SLACK_SERVER_PING_TIMEOUT_MS) || 30_000;
    if (cpt !== 5000 || spt !== 30000) {
      let _socketClient: unknown = null;
      Object.defineProperty(slackAdapter, 'socketClient', {
        get() {
          return _socketClient;
        },
        set(v: unknown) {
          if (v && typeof v === 'object') {
            (v as Record<string, unknown>).clientPingTimeoutMS = cpt;
            (v as Record<string, unknown>).serverPingTimeoutMS = spt;
          }
          _socketClient = v;
        },
        configurable: true,
        enumerable: false,
      });
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
