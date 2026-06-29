/**
 * Slack channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 *
 * Socket Mode opt-in: set SLACK_APP_TOKEN (xapp-…) to receive events over an
 * outbound WebSocket instead of an inbound HTTPS webhook.
 */
import { createSlackAdapter } from '@chat-adapter/slack';

import { readEnvFile } from '../env.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

registerChannelAdapter('slack', {
  factory: () => {
    const env = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN']);
    if (!env.SLACK_BOT_TOKEN) return null;
    // SLACK_APP_TOKEN (xapp-…) enables Socket Mode: events arrive over an
    // outbound WebSocket, so no public HTTPS endpoint is required. When set,
    // the signing secret is optional (Slack signs socket frames separately).
    const useSocketMode = Boolean(env.SLACK_APP_TOKEN);
    const slackAdapter = createSlackAdapter({
      botToken: env.SLACK_BOT_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
      appToken: env.SLACK_APP_TOKEN,
      mode: useSocketMode ? 'socket' : 'webhook',
    });

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
