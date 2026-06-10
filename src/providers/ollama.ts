/**
 * Ollama provider — routes container API calls to a local Ollama instance
 * instead of the Anthropic/OpenRouter API. Zero API cost, fully local inference.
 *
 * How it works:
 *   ANTHROPIC_BASE_URL  — points the Anthropic SDK at Ollama's /v1/messages endpoint
 *   ANTHROPIC_AUTH_TOKEN — dummy value; Ollama ignores auth but the SDK requires it
 *   NO_PROXY/no_proxy   — bypasses the OneCLI HTTPS proxy for host.docker.internal
 *   blockedHosts        — resolves api.anthropic.com and openrouter.ai to 0.0.0.0
 *                         so a model-name drift can't silently bill an external API
 *   bypassOnecli        — skips OneCLI credential injection (not needed for local)
 *
 * Switching a group to Ollama (after ncl / CLI is available):
 *   ncl groups update <group-id> --provider ollama
 *   ncl groups update <group-id> --model gemma4:latest   # exact name from `ollama list`
 *
 * The model is written to data/v2-sessions/<agent-group-id>/.claude-shared/settings.json
 * at spawn time. Use the exact model name from `ollama list`.
 *
 * Reverting to Claude via OpenRouter:
 *   ncl groups update <group-id> --provider claude
 *   ncl groups update <group-id> --model (unset or claude-sonnet-4-5)
 *
 * See docs/ollama.md for full background and tradeoff comparison.
 */
import { registerProviderContainerConfig } from './provider-container-registry.js';

registerProviderContainerConfig('ollama', () => ({
  env: {
    // Redirect the Anthropic SDK to Ollama's Anthropic-compatible messages endpoint.
    // host.docker.internal is Docker's magic hostname that resolves to the host
    // machine from inside the container — Ollama running on the host is reachable
    // at this address regardless of Docker network mode.
    ANTHROPIC_BASE_URL: 'http://host.docker.internal:11434',

    // Ollama doesn't require authentication, but the Anthropic SDK will not send
    // an Authorization header without a non-empty token value. Any non-empty
    // string works — Ollama simply ignores it.
    ANTHROPIC_AUTH_TOKEN: 'ollama',

    // Bypass the OneCLI HTTPS proxy for host.docker.internal so requests to
    // Ollama go direct rather than through the credential-injection gateway.
    // Both uppercase and lowercase forms are set for cross-tool compatibility.
    NO_PROXY: 'host.docker.internal',
    no_proxy: 'host.docker.internal',
  },

  // Block external AI API hosts at the network level.
  // These resolve to 0.0.0.0 inside the container, making them physically
  // unreachable. Without this, a model name like "claude-sonnet-4-5" in
  // settings.json would silently route to the real API and bill the account.
  blockedHosts: ['api.anthropic.com', 'openrouter.ai'],

  // OneCLI credential injection is not needed for local inference — skip it.
  // The proxy adds latency and would try to intercept traffic that never
  // leaves the machine anyway.
  bypassOnecli: true,
}));
