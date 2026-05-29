# 02 — AI Provider Layer (`pi-ai`)

## Summary

The `pi-ai` package (~28K LOC) is the LLM abstraction layer. It defines the unified `Model<Api>` type, the streaming event protocol (`AssistantMessageEvent`), and provider implementations for 20+ LLM services. Each provider registers a `StreamFunction` that converts a `Context` (system prompt + messages + tools) into an `AssistantMessageEventStream`. The package also handles OAuth flows, model cost tracking, and provider-specific compatibility shims.

## Key Types & Interfaces

### Core Types (`ai/src/types.ts`)

| Type | Description |
|---|---|
| `Model<TApi>` | Complete model definition: `id`, `name`, `api`, `provider`, `baseUrl`, `reasoning`, `input` types, `cost`, `contextWindow`, `maxTokens`, `headers?`, `compat?` |
| `Api` / `KnownApi` | API protocol string. Known: `anthropic-messages`, `openai-completions`, `openai-responses`, `google-generative-ai`, `bedrock-converse-stream`, etc. |
| `Provider` / `KnownProvider` | Provider identifier. 20+ known: `anthropic`, `openai`, `google`, `amazon-bedrock`, `github-copilot`, `xai`, `groq`, `openrouter`, etc. |
| `Context` | `{systemPrompt?, messages: Message[], tools?: Tool[]}` — what gets sent to the LLM |
| `Message` | Union: `UserMessage \| AssistantMessage \| ToolResultMessage` |
| `UserMessage` | `{role: "user", content: string \| (TextContent \| ImageContent)[], timestamp}` |
| `AssistantMessage` | `{role: "assistant", content: (TextContent \| ThinkingContent \| ToolCall)[], api, provider, model, usage, stopReason, errorMessage?, timestamp}` |
| `ToolResultMessage<T>` | `{role: "toolResult", toolCallId, toolName, content, details?, isError, timestamp}` |
| `Tool<TParams>` | `{name, description, parameters: TSchema}` — TypeBox schema |
| `Usage` | Token counts + costs: `{input, output, cacheRead, cacheWrite, totalTokens, cost: {...}}` |
| `StopReason` | `"stop" \| "length" \| "toolUse" \| "error" \| "aborted"` |

### Content Types

| Type | Description |
|---|---|
| `TextContent` | `{type: "text", text, textSignature?}` |
| `ThinkingContent` | `{type: "thinking", thinking, thinkingSignature?, redacted?}` |
| `ImageContent` | `{type: "image", data: base64, mimeType}` |
| `ToolCall` | `{type: "toolCall", id, name, arguments: Record<string, any>, thoughtSignature?}` |

### Streaming Protocol

| Event Type | When | Payload |
|---|---|---|
| `start` | Stream begins | `partial: AssistantMessage` |
| `text_start/delta/end` | Text content streaming | `contentIndex`, `delta`, `partial` |
| `thinking_start/delta/end` | Reasoning streaming | Same shape |
| `toolcall_start/delta/end` | Tool call streaming | `toolCall` on `_end` |
| `done` | Successful completion | `reason`, `message: AssistantMessage` |
| `error` | Failure/abort | `reason`, `error: AssistantMessage` |

`AssistantMessageEventStream` is an `EventStream<AssistantMessageEvent, AssistantMessage>` — async iterable with a `.result()` method for the final message.

### Stream Options

| Type | Description |
|---|---|
| `StreamOptions` | `temperature?`, `maxTokens?`, `signal?`, `apiKey?`, `transport?`, `cacheRetention?`, `sessionId?`, `onPayload?`, `onResponse?`, `headers?`, `maxRetryDelayMs?`, `metadata?` |
| `SimpleStreamOptions` | Extends `StreamOptions` with `reasoning?: ThinkingLevel`, `thinkingBudgets?` |
| `StreamFunction<TApi, TOptions>` | `(model, context, options?) → AssistantMessageEventStream` |
| `ThinkingLevel` | `"minimal" \| "low" \| "medium" \| "high" \| "xhigh"` |
| `Transport` | `"sse" \| "websocket" \| "auto"` |
| `CacheRetention` | `"none" \| "short" \| "long"` |

### Provider Compatibility

| Type | Description |
|---|---|
| `OpenAICompletionsCompat` | 15+ compatibility flags for OpenAI-like APIs: `supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `reasoningEffortMap`, `maxTokensField`, `thinkingFormat`, `cacheControlFormat`, etc. |
| `OpenRouterRouting` | Provider routing: `allow_fallbacks`, `require_parameters`, `order`, `only`, `ignore`, `quantizations`, `max_price`, `preferred_min_throughput` |
| `VercelGatewayRouting` | Gateway routing: `only`, `order` |

## Flow

### Streaming a Response

```
streamSimple(model, context, options)
  1. Look up registered StreamFunction for model.api
  2. Apply reasoning level → provider-specific parameter (budget tokens, effort string, etc.)
  3. Call provider's stream function:
     a. Build HTTP request body (system prompt → messages → tools)
     b. Apply cache control markers if supported
     c. Call onPayload callback if registered
     d. Send HTTP request (SSE or WebSocket)
     e. Call onResponse callback
     f. Parse SSE events into AssistantMessageEvent protocol
     g. Accumulate partial AssistantMessage
     h. On completion: calculate usage & costs, emit done/error
  4. Return AssistantMessageEventStream
```

### Provider Registration

Providers are registered via `registerApiProvider(api, streamFn)` in `api-registry.ts`. Built-in providers are registered in `providers/register-builtins.ts`. Extensions can register custom providers via `pi.registerProvider()` which ultimately calls `registerApiProvider`.

## Provider Implementations

| Provider File | API | Notes |
|---|---|---|
| `anthropic.ts` | `anthropic-messages` | Native Anthropic API, prompt caching, thinking blocks |
| `openai-completions.ts` | `openai-completions` | Chat completions, supports 15+ compat flags |
| `openai-responses.ts` | `openai-responses` | Responses API (newer) |
| `openai-codex-responses.ts` | `openai-codex-responses` | Codex-specific responses |
| `azure-openai-responses.ts` | `azure-openai-responses` | Azure-hosted OpenAI |
| `google.ts` | `google-generative-ai` | Google Gemini API |
| `google-vertex.ts` | `google-vertex` | Vertex AI |
| `google-gemini-cli.ts` | `google-gemini-cli` | Gemini CLI subscription |
| `amazon-bedrock.ts` | `bedrock-converse-stream` | AWS Bedrock via SDK |
| `mistral.ts` | `mistral-conversations` | Mistral API |
| `faux.ts` | — | Test/mock provider |

All other providers (xAI, Groq, Cerebras, OpenRouter, etc.) use `openai-completions` with appropriate `compat` settings.

## Integration Points

| Connects to | How |
|---|---|
| **Agent Core (doc 03)** | `StreamFn` type alias = `streamSimple` signature; agent loop calls it per turn |
| **Model Registry (doc 12)** | `Model<Api>` instances created by model registry, consumed by providers |
| **Extension System (doc 06)** | `before_provider_request` / `after_provider_response` events fire around provider calls; custom providers via `registerProvider` |
| **Bootstrap (doc 01)** | Auth resolution: CLI key → runtime key → env var → auth file → OAuth |

## Extension Relevance

- **Custom providers**: `pi.registerProvider(name, {baseUrl, api, models, oauth?, streamSimple?})` — full provider with custom streaming logic.
- **Payload inspection**: `before_provider_request` event gives raw HTTP payload before sending; return a replacement to modify.
- **Response inspection**: `after_provider_response` event gives status + headers after HTTP response.
- **Model overrides**: `pi.registerProvider("anthropic", {baseUrl: "https://proxy.example.com"})` to proxy an existing provider.
- **OAuth flows**: Register `oauth: {login, refreshToken, getApiKey}` for `/login` support.

## Open Questions

1. **Provider fallback chains**: `ProviderFallbackConfig` exists in config but the actual fallback execution path in pi (vs Claw Code) wasn't traced.
2. **WebSocket transport**: Some providers support `transport: "websocket"` — how widely tested is this?
3. **Token counting**: `estimateContextTokens()` in compaction uses heuristics, not the actual tokenizer. Accuracy varies by provider.

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `ai/src/types.ts` | 417 | All core types, message types, streaming protocol, provider compat |
| `ai/src/stream.ts` | 59 | `streamSimple` entry point |
| `ai/src/models.ts` | 82 | Model utility functions |
| `ai/src/api-registry.ts` | ~100 | Provider registration registry |
| `ai/src/providers/register-builtins.ts` | ~50 | Built-in provider registration |
