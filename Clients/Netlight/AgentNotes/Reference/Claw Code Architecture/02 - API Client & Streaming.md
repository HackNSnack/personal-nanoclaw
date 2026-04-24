# 02 -- API Client & Streaming

## Summary (2-3 sentences)

The API layer (`rust/crates/api/`) is the unified interface between claw-code's conversation loop and multiple LLM provider backends (Anthropic, xAI, OpenAI, DashScope/Qwen, Kimi). It abstracts provider-specific wire formats behind a common `ProviderClient` enum and `MessageRequest`/`MessageResponse` type system, translating between the Anthropic-native message schema (used as the canonical internal representation) and OpenAI-compatible chat-completion payloads. The layer handles SSE streaming, exponential-backoff retry with jitter, prompt caching (Anthropic-only), OAuth token refresh, proxy configuration, context-window preflight checks, request body size guards, and per-provider credential resolution including `.env` file fallback.

## Key Types & Structs

### Core Client Types (client.rs)

- **`ProviderClient`** (enum) -- Top-level dispatch enum with three variants: `Anthropic(AnthropicClient)`, `Xai(OpenAiCompatClient)`, `OpenAi(OpenAiCompatClient)`. This is the single type the conversation loop holds. Constructed via `from_model()` or `from_model_with_anthropic_auth()`. Methods: `send_message()`, `stream_message()`, `provider_kind()`, `with_prompt_cache()`, `prompt_cache_stats()`, `take_last_prompt_cache_record()`.

- **`MessageStream`** (enum, client.rs) -- Top-level stream wrapper with variants `Anthropic(anthropic::MessageStream)` and `OpenAiCompat(openai_compat::MessageStream)`. Exposes `next_event() -> Result<Option<StreamEvent>, ApiError>` and `request_id()`. The conversation loop polls this in a loop until `None` signals completion.

### Message Types (types.rs)

- **`MessageRequest`** -- The canonical request payload. Fields: `model`, `max_tokens`, `messages: Vec<InputMessage>`, `system: Option<String>`, `tools: Option<Vec<ToolDefinition>>`, `tool_choice: Option<ToolChoice>`, `stream: bool`, plus OpenAI-compat tuning params: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`, `reasoning_effort`. Has a `with_streaming()` builder method.

- **`InputMessage`** -- A single message in the conversation. Fields: `role: String`, `content: Vec<InputContentBlock>`. Helper constructors: `user_text()`, `user_tool_result()`.

- **`InputContentBlock`** (enum, tagged by `type`) -- Three variants:
  - `Text { text }` -- plain text content
  - `ToolUse { id, name, input: Value }` -- assistant's tool invocation (in prior turns)
  - `ToolResult { tool_use_id, content: Vec<ToolResultContentBlock>, is_error }` -- result of a tool execution

- **`ToolResultContentBlock`** (enum, tagged by `type`) -- `Text { text }` or `Json { value: Value }`.

- **`ToolDefinition`** -- `name: String`, `description: Option<String>`, `input_schema: Value` (JSON Schema).

- **`ToolChoice`** (enum, tagged by `type`) -- `Auto`, `Any`, `Tool { name }`.

- **`MessageResponse`** -- The canonical response. Fields: `id`, `kind` (always "message"), `role`, `content: Vec<OutputContentBlock>`, `model`, `stop_reason: Option<String>`, `stop_sequence: Option<String>`, `usage: Usage`, `request_id: Option<String>`. Method: `total_tokens()`.

- **`OutputContentBlock`** (enum, tagged by `type`) -- Four variants:
  - `Text { text }` -- plain text
  - `ToolUse { id, name, input: Value }` -- the model invoked a tool
  - `Thinking { thinking, signature: Option<String> }` -- extended thinking content (Anthropic)
  - `RedactedThinking { data: Value }` -- redacted thinking content (Anthropic)

- **`Usage`** -- Token counts: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`. Methods: `total_tokens()`, `token_usage()` (converts to runtime's `TokenUsage`), `estimated_cost_usd(model)` (delegates to runtime pricing tables).

### Streaming Event Types (types.rs)

- **`StreamEvent`** (enum, tagged by `type`) -- The six SSE event types the conversation loop consumes:
  - `MessageStart(MessageStartEvent)` -- contains the initial `MessageResponse` skeleton (empty content, zero usage)
  - `ContentBlockStart(ContentBlockStartEvent)` -- `index: u32`, `content_block: OutputContentBlock`
  - `ContentBlockDelta(ContentBlockDeltaEvent)` -- `index: u32`, `delta: ContentBlockDelta`
  - `ContentBlockStop(ContentBlockStopEvent)` -- `index: u32`
  - `MessageDelta(MessageDeltaEvent)` -- `delta: MessageDelta` (stop_reason), `usage: Usage` (final token counts)
  - `MessageStop(MessageStopEvent)` -- signals stream completion

- **`ContentBlockDelta`** (enum, tagged by `type`) -- Four delta variants:
  - `TextDelta { text }` -- incremental text
  - `InputJsonDelta { partial_json }` -- incremental tool argument JSON
  - `ThinkingDelta { thinking }` -- incremental thinking content
  - `SignatureDelta { signature }` -- thinking signature

- **`MessageStartEvent`** -- wraps `message: MessageResponse`.
- **`MessageDeltaEvent`** -- wraps `delta: MessageDelta` + `usage: Usage`.
- **`MessageDelta`** -- `stop_reason: Option<String>`, `stop_sequence: Option<String>`.
- **`ContentBlockStartEvent`** -- `index: u32`, `content_block: OutputContentBlock`.
- **`ContentBlockDeltaEvent`** -- `index: u32`, `delta: ContentBlockDelta`.
- **`ContentBlockStopEvent`** -- `index: u32`.
- **`MessageStopEvent`** -- empty struct, marks stream end.

### Error Types (error.rs)

- **`ApiError`** (enum) -- Comprehensive error type with variants:
  - `MissingCredentials { provider, env_vars, hint }` -- no API key found; optional hint suggests if another provider's key is present
  - `ContextWindowExceeded { model, estimated_input_tokens, requested_output_tokens, estimated_total_tokens, context_window_tokens }` -- local preflight rejection before sending to provider
  - `ExpiredOAuthToken` -- saved OAuth token is expired with no refresh token
  - `Auth(String)` -- generic auth error
  - `InvalidApiKeyEnv(VarError)` -- env var read failure
  - `Http(reqwest::Error)` -- transport error
  - `Io(std::io::Error)` -- file I/O error
  - `Json { provider, model, body_snippet, source }` -- deserialization failure with context (first 200 chars of body)
  - `Api { status, error_type, message, request_id, body, retryable, suggested_action }` -- provider HTTP error response
  - `RetriesExhausted { attempts, last_error }` -- all retries failed
  - `InvalidSseFrame(&'static str)` -- malformed SSE data
  - `BackoffOverflow { attempt, base_delay }` -- backoff calculation overflow
  - `RequestBodySizeExceeded { estimated_bytes, max_bytes, provider }` -- pre-flight body size check failure
  
  Key methods: `is_retryable()`, `request_id()`, `safe_failure_class()` (returns a static string like "context_window", "provider_auth", "provider_rate_limit", etc.), `is_generic_fatal_wrapper()`, `is_context_window_failure()`.

### Provider Infrastructure (providers/mod.rs)

- **`ProviderKind`** (enum) -- `Anthropic`, `Xai`, `OpenAi`. Note: DashScope/Qwen/Kimi use `OpenAi` kind since they speak the OpenAI wire format.

- **`ProviderMetadata`** -- `provider: ProviderKind`, `auth_env`, `base_url_env`, `default_base_url`. Used by the model registry and routing logic.

- **`ModelTokenLimit`** -- `max_output_tokens: u32`, `context_window_tokens: u32`. Known limits for supported models.

- **`Provider`** (trait, dead_code-allowed) -- `send_message()` and `stream_message()` returning `ProviderFuture<'a, T>`. Both `AnthropicClient` and `OpenAiCompatClient` implement this.

- **`ProviderFuture<'a, T>`** -- type alias for `Pin<Box<dyn Future<Output = Result<T, ApiError>> + Send + 'a>>`.

Key functions:
  - `resolve_model_alias(model)` -- maps short aliases ("opus", "sonnet", "haiku", "grok", "grok-mini", "kimi") to canonical model names ("claude-opus-4-6", "grok-3", "kimi-k2.5", etc.)
  - `detect_provider_kind(model)` -- determines which provider to use: first checks `metadata_for_model()` for known prefixes (claude, grok, openai/, gpt-, qwen/, kimi/), then falls back to auth-sniffer order (OPENAI_BASE_URL > Anthropic env > OPENAI_API_KEY > XAI_API_KEY > OPENAI_BASE_URL-without-key > Anthropic default)
  - `metadata_for_model(model)` -- returns `ProviderMetadata` for known model prefixes
  - `max_tokens_for_model(model)` -- returns max output tokens for known models (32k for opus, 64k for sonnet/haiku/grok, 16k for kimi)
  - `max_tokens_for_model_with_override(model, plugin_override)` -- respects plugin config override
  - `model_token_limit(model)` -- returns `ModelTokenLimit` with context window sizes (200k Anthropic, 131k grok, 256k kimi)
  - `preflight_message_request(request)` -- local byte-estimate guard against context window overflow
  - `anthropic_missing_credentials()` -- builds a `MissingCredentials` error with smart hints about foreign provider env vars

### Anthropic Client (providers/anthropic.rs)

- **`AuthSource`** (enum) -- `None`, `ApiKey(String)`, `BearerToken(String)`, `ApiKeyAndBearer { api_key, bearer_token }`. Methods: `from_env()`, `from_env_or_saved()`, `api_key()`, `bearer_token()`, `apply(request_builder)` (adds x-api-key and/or Bearer headers).

- **`OAuthTokenSet`** -- `access_token`, `refresh_token: Option`, `expires_at: Option<u64>`, `scopes: Vec<String>`. Deserializable from OAuth token endpoint responses. Converts into `AuthSource::BearerToken`.

- **`AnthropicClient`** -- Fields: `http: reqwest::Client`, `auth: AuthSource`, `base_url`, `max_retries` (default 8), `initial_backoff` (1s), `max_backoff` (128s), `request_profile: AnthropicRequestProfile`, `session_tracer: Option<SessionTracer>`, `prompt_cache: Option<PromptCache>`, `last_prompt_cache_record: Arc<Mutex<Option<PromptCacheRecord>>>`.

  Constructors: `new(api_key)`, `from_auth(auth)`, `from_env()` (reads env vars + `.env` fallback).
  
  Builder methods: `with_base_url()`, `with_retry_policy()`, `with_session_tracer()`, `with_client_identity()`, `with_beta()`, `with_extra_body_param()`, `with_prompt_cache()`, `with_request_profile()`, `with_auth_token()`.

- **`anthropic::MessageStream`** -- Holds the live `reqwest::Response`, an `SseParser`, a `VecDeque<StreamEvent>` pending buffer, the original `MessageRequest`, optional `PromptCache`, latest `Usage`, and the shared `last_prompt_cache_record` arc. `next_event()` reads chunks from the HTTP response, pushes through the SSE parser, queues events, and observes `MessageDelta` (capture usage) and `MessageStop` (record prompt cache usage) events.

Key internal functions:
  - `send_with_retry()` -- retry loop with exponential backoff + jitter
  - `send_raw_request()` -- builds and sends the actual HTTP request to `/v1/messages`. Uses `request_profile.render_json_body()` then `strip_unsupported_beta_body_fields()` to remove OpenAI-only fields and convert `stop` to `stop_sequences`.
  - `preflight_message_request()` -- runs local byte-estimate guard, then best-effort calls `/v1/messages/count_tokens` for a more accurate token count
  - `count_tokens()` -- calls the Anthropic count_tokens endpoint
  - `expect_success()` -- checks HTTP status, parses Anthropic error envelope, determines retryability
  - `enrich_bearer_auth_error()` -- adds a helpful hint when users put an `sk-ant-*` key in `ANTHROPIC_AUTH_TOKEN` instead of `ANTHROPIC_API_KEY`
  - `strip_unsupported_beta_body_fields()` -- removes `betas`, `frequency_penalty`, `presence_penalty` from the body, converts `stop` to `stop_sequences`
  - `jitter_for_base()` -- splitmix64-based jitter generation for retry decorrelation
  - OAuth methods: `exchange_oauth_code()`, `refresh_oauth_token()`

### OpenAI-Compatible Client (providers/openai_compat.rs)

- **`OpenAiCompatConfig`** -- Static config per provider: `provider_name`, `api_key_env`, `base_url_env`, `default_base_url`, `max_request_body_bytes`. Factory methods: `xai()` (50MB), `openai()` (100MB), `dashscope()` (6MB).

- **`OpenAiCompatClient`** -- Fields: `http`, `api_key`, `config`, `base_url`, `max_retries`, `initial_backoff`, `max_backoff`. Constructors: `new(api_key, config)`, `from_env(config)`.

- **`openai_compat::MessageStream`** -- Holds `reqwest::Response`, `OpenAiSseParser`, `VecDeque<StreamEvent>` pending buffer, `StreamState`. The `next_event()` method reads chunks, parses them into `ChatCompletionChunk` values via the SSE parser, then feeds them through `StreamState::ingest_chunk()` which translates OpenAI-format streaming events into Anthropic-native `StreamEvent`s.

- **`OpenAiSseParser`** -- Internal SSE parser (separate from the shared `SseParser` in sse.rs) that deserializes frames into `ChatCompletionChunk` instead of `StreamEvent`. Handles `[DONE]` sentinel, comments, and embedded error objects in stream frames.

- **`StreamState`** -- Stateful accumulator that translates OpenAI streaming chunks into the Anthropic-native `StreamEvent` sequence. Tracks: `message_started`, `text_started`, `text_finished`, `finished`, `stop_reason`, `usage`, `tool_calls: BTreeMap<u32, ToolCallState>`. On finish, emits the `MessageDelta` (with stop reason and usage) and `MessageStop`.

- **`ToolCallState`** -- Accumulates partial tool call data across stream chunks: `id`, `name`, `arguments` (appended incrementally), `emitted_len` (tracks delta emission offset), `started`, `stopped`. Computes `block_index()` as `openai_index + 1` (index 0 is reserved for text).

Key public functions:
  - `build_chat_completion_request(request, config)` -- translates `MessageRequest` into OpenAI-compatible JSON. Handles: system message insertion, routing prefix stripping, tool definition translation (with schema normalization), tool choice mapping, reasoning model detection (strips tuning params), `stream_options` for OpenAI, `max_completion_tokens` for gpt-5, orphaned tool message sanitization.
  - `translate_message(message, model)` -- converts `InputMessage` into OpenAI-format JSON messages. Handles: assistant messages with/without tool_calls, user text, tool results (with conditional `is_error` field exclusion for kimi models).
  - `flatten_tool_result_content(content)` -- joins `ToolResultContentBlock` variants into a single string.
  - `is_reasoning_model(model)` -- detects models that reject tuning params (o1/o3/o4, grok-3-mini, qwq, *-thinking).
  - `model_rejects_is_error_field(model)` -- detects kimi models that reject the `is_error` tool result field.
  - `sanitize_tool_message_pairing(messages)` -- drops orphaned `role:"tool"` messages that have no matching preceding assistant `tool_calls` entry.
  - `normalize_finish_reason()` -- maps OpenAI stop reasons to Anthropic equivalents ("stop" -> "end_turn", "tool_calls" -> "tool_use").
  - `strip_routing_prefix()` -- removes "openai/", "xai/", "qwen/", "kimi/" prefixes for the wire model name.
  - `check_request_body_size()` -- pre-flight guard against provider-specific body size limits.

### SSE Parsing (sse.rs)

- **`SseParser`** -- Shared SSE frame parser used by the Anthropic stream path. Accumulates raw bytes, splits on `\n\n` or `\r\n\r\n` frame boundaries, extracts `event:` and `data:` fields, joins multi-line `data:` payloads. Methods: `new()`, `with_context(provider, model)`, `push(chunk) -> Vec<StreamEvent>`, `finish() -> Vec<StreamEvent>`. Ignores ping events and `[DONE]` sentinel. Deserializes data payloads directly into `StreamEvent` (since Anthropic's wire format matches).

- **`parse_frame(frame)`** -- Standalone function for parsing a single SSE frame string into an `Option<StreamEvent>`.

### Prompt Caching (prompt_cache.rs)

- **`PromptCacheConfig`** -- `session_id`, `completion_ttl` (default 30s), `prompt_ttl` (default 5min), `cache_break_min_drop` (default 2000 tokens).

- **`PromptCachePaths`** -- File paths for the cache: `root`, `session_dir`, `completion_dir`, `session_state_path`, `stats_path`. Factory: `for_session(session_id)`. Root is `$CLAUDE_CONFIG_HOME/cache/prompt-cache/` or `~/.claude/cache/prompt-cache/`.

- **`PromptCacheStats`** -- Persistent statistics: `tracked_requests`, `completion_cache_hits`, `completion_cache_misses`, `completion_cache_writes`, `expected_invalidations`, `unexpected_cache_breaks`, `total_cache_creation_input_tokens`, `total_cache_read_input_tokens`, plus `last_*` fields for the most recent request.

- **`CacheBreakEvent`** -- Describes a cache invalidation: `unexpected: bool`, `reason: String`, `previous_cache_read_input_tokens`, `current_cache_read_input_tokens`, `token_drop`.

- **`PromptCacheRecord`** -- Returned after recording a response: `cache_break: Option<CacheBreakEvent>`, `stats: PromptCacheStats`.

- **`PromptCache`** -- Thread-safe (`Arc<Mutex<PromptCacheInner>>`) cache manager. Anthropic-only (OpenAI-compat providers return `None` for all cache methods). Methods:
  - `lookup_completion(request)` -- checks for a cached completion response by request hash (FNV-1a). Returns `Some(MessageResponse)` on hit, `None` on miss/expiry.
  - `record_response(request, response)` -- writes the completion to disk and records usage/cache-break detection.
  - `record_usage(request, usage)` -- records usage without caching a completion (used by streaming path via `MessageStream::observe_event`).

  Cache break detection: compares `TrackedPromptState` fingerprints (FNV-1a hashes of model, system, tools, messages) between the previous and current request. A break is flagged when `cache_read_input_tokens` drops by more than `cache_break_min_drop`. Classified as expected (prompt changed) or unexpected (fingerprint stable but tokens dropped -- possible server-side TTL expiry or flaky cache).

### HTTP Client (http_client.rs)

- **`ProxyConfig`** -- `http_proxy`, `https_proxy`, `no_proxy`, `proxy_url` (unified override). Reads from `HTTP_PROXY`/`http_proxy`, `HTTPS_PROXY`/`https_proxy`, `NO_PROXY`/`no_proxy` env vars (uppercase preferred). `from_proxy_url()` creates a unified config.

- **`build_http_client()`** -- Builds a `reqwest::Client` honoring proxy env vars.
- **`build_http_client_or_default()`** -- Infallible version; falls back to `reqwest::Client::new()` on error.
- **`build_http_client_with(config)`** -- Builds from explicit `ProxyConfig`. Starts with `no_proxy()`, adds HTTPS proxy first, then HTTP proxy, applies `NoProxy` filter to each.

### Provider Detection & Model Registry (providers/mod.rs)

The `MODEL_REGISTRY` is a static array mapping short aliases to `ProviderMetadata`. Known entries: opus, sonnet, haiku (Anthropic); grok, grok-3, grok-mini, grok-3-mini, grok-2 (xAI); kimi (DashScope).

`metadata_for_model()` uses prefix matching beyond the registry: `claude*` -> Anthropic, `grok*` -> xAI, `openai/*` or `gpt-*` -> OpenAI, `qwen/*` or `qwen-*` -> DashScope, `kimi/*` or `kimi-*` -> DashScope.

`.env` file support: `parse_dotenv()` parses KEY=VALUE lines (supports comments, quotes, `export` prefix). `dotenv_value(key)` looks up a key in `$CWD/.env`. Both `read_env_non_empty()` functions (Anthropic and OpenAI-compat) fall back to `.env` when the real env var is missing.

## Flow

### Non-Streaming Request Path

1. Caller constructs a `MessageRequest` (typically via the prompt builder)
2. Caller calls `ProviderClient::send_message(request)` which dispatches to the correct provider
3. **Anthropic path** (`AnthropicClient::send_message`):
   a. Checks `prompt_cache.lookup_completion(request)` for a cached response -- returns immediately on hit
   b. Calls `preflight_message_request(request)`:
      - First runs local byte-estimate guard (`providers::preflight_message_request`) -- serializes request, divides by 4, checks against `model_token_limit` context window
      - Then best-effort calls Anthropic `/v1/messages/count_tokens` for accurate count
   c. Calls `send_with_retry(request)`:
      - Loop up to `max_retries` + 1 attempts
      - Each attempt: `send_raw_request()` -> `expect_success()`
      - On retryable failure: sleep with `jittered_backoff_for_attempt()` (exponential backoff 1s/2s/4s/.../128s + splitmix64 additive jitter in [0, base])
      - On non-retryable failure: return error (after `enrich_bearer_auth_error()`)
      - On exhaustion: return `ApiError::RetriesExhausted`
   d. `send_raw_request()`: builds URL `{base_url}/v1/messages`, calls `request_profile.render_json_body()`, strips unsupported fields, applies auth headers, sends POST
   e. Parses response body as `MessageResponse`, attaches `request_id` from headers
   f. Records to `prompt_cache.record_response(request, response)` and stores cache record
   g. Records analytics via `session_tracer` (if present)
   h. Returns `MessageResponse`

4. **OpenAI-compat path** (`OpenAiCompatClient::send_message`):
   a. Calls `preflight_message_request(request)` (local byte-estimate only, no count_tokens endpoint)
   b. Calls `send_with_retry(request)`:
      - Each attempt: `send_raw_request()` -> pre-flight `check_request_body_size()`, builds URL via `chat_completions_endpoint()`, sends JSON via `build_chat_completion_request()`
   c. Checks for embedded error objects in response JSON (some backends return `{"error":{...}}` with 200 status)
   d. Parses as `ChatCompletionResponse`, calls `normalize_response()` to convert to `MessageResponse` (maps OpenAI fields to Anthropic-native schema, converts finish reasons)

### Streaming Request Path

1. Caller calls `ProviderClient::stream_message(request)` -> returns `MessageStream`
2. Caller polls `MessageStream::next_event()` in a loop until `Ok(None)`:

   **Anthropic stream path**:
   a. Pops from `pending` queue if available
   b. If `done`, calls `parser.finish()` for trailing events
   c. Otherwise reads next HTTP chunk via `response.chunk().await`
   d. Pushes chunk bytes through `SseParser::push()` which:
      - Appends to byte buffer
      - Scans for `\n\n` or `\r\n\r\n` frame boundaries
      - For each complete frame: extracts `event:` name and `data:` lines, joins multi-data payloads, ignores pings and `[DONE]`, deserializes directly into `StreamEvent`
   e. `observe_event()` captures usage from `MessageDelta` events and records prompt cache on `MessageStop`
   f. Returns next `StreamEvent`

   **OpenAI-compat stream path**:
   a. Same pending/done/chunk loop
   b. Chunk bytes go through `OpenAiSseParser::push()` which produces `ChatCompletionChunk` values
   c. Each chunk is fed into `StreamState::ingest_chunk()` which:
      - Emits `MessageStart` on first chunk (synthesizes an initial `MessageResponse` skeleton)
      - Emits `ContentBlockStart(index=0, Text)` + `ContentBlockDelta(TextDelta)` for text deltas
      - Tracks tool calls via `BTreeMap<u32, ToolCallState>`: accumulates ID/name/arguments across chunks, emits `ContentBlockStart(ToolUse)` when name is known, emits `ContentBlockDelta(InputJsonDelta)` for argument fragments, emits `ContentBlockStop` when finish_reason is "tool_calls"
      - Captures usage from `usage` field
      - Maps finish_reason: "stop" -> "end_turn", "tool_calls" -> "tool_use"
   d. `StreamState::finish()` emits any remaining `ContentBlockStop` events, then `MessageDelta` (with stop reason and usage) and `MessageStop`

### Provider Selection Flow

1. `ProviderClient::from_model(model)` calls `resolve_model_alias()` (e.g. "opus" -> "claude-opus-4-6")
2. Calls `detect_provider_kind(resolved_model)`:
   - First: `metadata_for_model()` checks known prefixes (claude, grok, openai/, gpt-, qwen/, kimi/)
   - Fallback: env-var sniffer order: OPENAI_BASE_URL+OPENAI_API_KEY -> Anthropic env -> OPENAI_API_KEY -> XAI_API_KEY -> OPENAI_BASE_URL-alone -> Anthropic default
3. Based on `ProviderKind`:
   - `Anthropic`: constructs `AnthropicClient` from auth (env or explicit) with base URL from `ANTHROPIC_BASE_URL`
   - `Xai`: constructs `OpenAiCompatClient` with `OpenAiCompatConfig::xai()`
   - `OpenAi`: checks `metadata_for_model` to decide between `OpenAiCompatConfig::openai()` vs `OpenAiCompatConfig::dashscope()` (for qwen/kimi models)

### Credential Resolution

- **Anthropic**: reads `ANTHROPIC_API_KEY` and/or `ANTHROPIC_AUTH_TOKEN` from env or `.env`. Both can coexist (`ApiKeyAndBearer`). On failure, produces `MissingCredentials` with smart hints if OPENAI_API_KEY/XAI_API_KEY/DASHSCOPE_API_KEY is detected.
- **OpenAI-compat**: reads the provider-specific env var (`OPENAI_API_KEY`, `XAI_API_KEY`, `DASHSCOPE_API_KEY`) from env or `.env`.
- **OAuth**: `resolve_saved_oauth_token()` loads from disk, refreshes if expired (blocking tokio runtime creation for sync call sites), saves refreshed token. `resolve_startup_auth_source()` currently only checks env vars (OAuth flow is commented out / simplified).

## Integration Points

### Conversation Loop -> API
- The conversation loop (likely in the `runtime` or `cli` crate) holds a `ProviderClient` and calls `stream_message()` for each turn
- It polls `MessageStream::next_event()` to get streaming events, rendering text deltas to the TUI as they arrive
- Tool use is detected from `OutputContentBlock::ToolUse` in `ContentBlockStart` events; the loop executes tools and feeds back `InputContentBlock::ToolResult`

### Prompt Builder -> API
- The prompt builder constructs `MessageRequest` with system prompt, messages, and tool definitions
- `MessageRequest` is the shared contract; the prompt builder populates it, the API layer consumes it
- The prompt builder likely uses `max_tokens_for_model()` or `max_tokens_for_model_with_override()` to set `max_tokens`

### Prompt Caching -> Prompt Builder
- `PromptCache` is attached to `AnthropicClient` via `with_prompt_cache()`
- The cache tracks fingerprints of model/system/tools/messages to detect cache breaks
- `CacheBreakEvent` is surfaced to callers via `take_last_prompt_cache_record()` so the conversation loop can log/display cache invalidation events
- Completion caching (`lookup_completion` / `record_response`) avoids re-sending identical requests within the TTL window

### Auth -> Config Layer
- `AuthSource::from_env_or_saved()` reads from env vars with `.env` fallback
- `read_base_url()` reads `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `XAI_BASE_URL` / `DASHSCOPE_BASE_URL`
- `AnthropicClient` accepts an `AnthropicRequestProfile` (from the `telemetry` crate) for custom headers and body params (betas, extra body fields, client identity)

### Telemetry -> API
- `AnthropicClient` optionally holds a `SessionTracer` that records HTTP request lifecycle events (started, succeeded, failed)
- Analytics events with cost estimates are emitted after successful `send_message()` calls
- `safe_failure_class()` on `ApiError` produces structured failure categories for telemetry

### Runtime Crate -> API
- `Usage::token_usage()` converts to `runtime::TokenUsage`
- `Usage::estimated_cost_usd()` delegates to `runtime::pricing_for_model()` for cost estimation
- OAuth config types (`OAuthConfig`, `OAuthTokenExchangeRequest`, `OAuthRefreshRequest`, `OAuthTokenSet`) bridge between the runtime crate's OAuth infrastructure and the API crate's token management

### HTTP Client -> Proxy Config
- `ProxyConfig` is resolved from env vars or set explicitly (e.g., from config file `proxy_url` field)
- Both `AnthropicClient` and `OpenAiCompatClient` use `build_http_client_or_default()` which calls `build_http_client_with(ProxyConfig::from_env())`

## Open Questions

1. **Provider trait is dead_code**: The `Provider` trait in `providers/mod.rs` is marked `#[allow(dead_code)]` along with `ProviderFuture`. Both `AnthropicClient` and `OpenAiCompatClient` implement it, but the trait dispatch isn't used at the `ProviderClient` level -- instead `ProviderClient` manually delegates via match arms. Is the trait intended for future use, or is it vestigial?

2. **No prompt caching for OpenAI-compat**: `PromptCache` is Anthropic-only; `with_prompt_cache()` on non-Anthropic variants is a no-op. If OpenAI-compat providers gain cache support, the `PromptCache` integration will need extending.

3. **OAuth flow is simplified**: `resolve_startup_auth_source()` accepts a `load_oauth_config` closure but immediately discards it (`let _ = load_oauth_config`). The function only checks env vars. The full OAuth flow (with saved token loading and refresh) exists in `resolve_saved_oauth_token()` but is not wired into the startup path. This may be intentional simplification or a WIP.

4. **Jitter duplication**: Both `anthropic.rs` and `openai_compat.rs` have independent `JITTER_COUNTER` statics and duplicate `jitter_for_base()` implementations. These could be unified into a shared module.

5. **Backoff duplication**: Both providers duplicate the entire retry loop, backoff calculation, and `expect_success()` pattern. A shared retry executor would reduce the surface area.

6. **SSE parser duplication**: Anthropic uses the shared `SseParser` (sse.rs) which deserializes directly into `StreamEvent`. OpenAI-compat has its own `OpenAiSseParser` that deserializes into `ChatCompletionChunk`. The frame-level parsing (buffer management, `\n\n` splitting) is duplicated. The OpenAI parser also handles embedded error objects in stream frames, which the Anthropic parser does not.

7. **Prompt cache file I/O on critical path**: `lookup_completion()` and `record_response()` perform synchronous filesystem reads/writes (`fs::read`, `fs::write`) while holding the mutex lock. This could cause latency spikes on slow filesystems.

8. **`model_token_limit` coverage**: Only a handful of models have registered token limits (opus, sonnet, haiku, grok-3, grok-3-mini, kimi-k2.5, kimi-k1.5). Unknown models skip the preflight check entirely. Any gpt-* model, for example, has no context window guard.

9. **DashScope base URL differs from OpenAI pattern**: DashScope uses `/compatible-mode/v1` as its base URL, while the `chat_completions_endpoint()` function appends `/chat/completions`. This means the full endpoint is `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`. This works but is worth noting for debugging.

10. **Stream usage recording asymmetry**: Anthropic streaming records prompt cache usage on `MessageStop` via `observe_event()`, but OpenAI-compat streaming does not interact with prompt cache at all (since `PromptCache` is Anthropic-only). Usage from OpenAI-compat streams is captured in `StreamState` but not persisted anywhere beyond what the caller does with the `MessageDelta` event.

## Key Files Read

- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/lib.rs` -- module exports, public API surface, re-exports from all submodules
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/client.rs` -- `ProviderClient` enum, top-level `MessageStream` enum, provider dispatch, model-to-client construction
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/types.rs` -- all message types (`MessageRequest`, `MessageResponse`, `InputMessage`, `InputContentBlock`, `OutputContentBlock`, `ToolDefinition`, `ToolChoice`, `Usage`), all streaming event types (`StreamEvent`, `ContentBlockDelta`, `MessageDelta`, etc.)
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/error.rs` -- `ApiError` enum with all variants, retryability logic, failure classification, context window detection, Display formatting
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/http_client.rs` -- `ProxyConfig`, `build_http_client()` family, proxy env var resolution
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/sse.rs` -- `SseParser` (Anthropic SSE parser), `parse_frame()`, frame boundary detection, data line joining
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/prompt_cache.rs` -- `PromptCache`, `PromptCacheConfig`, `PromptCachePaths`, `PromptCacheStats`, `CacheBreakEvent`, `PromptCacheRecord`, cache break detection, FNV-1a hashing, completion cache round-trip
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/providers/mod.rs` -- `ProviderKind`, `ProviderMetadata`, `ModelTokenLimit`, `Provider` trait, model alias resolution, provider detection, preflight checks, model registry, `.env` parsing, foreign-credential hint system
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/providers/anthropic.rs` -- `AnthropicClient`, `AuthSource`, `OAuthTokenSet`, `anthropic::MessageStream`, retry logic, preflight with count_tokens, OAuth exchange/refresh, bearer auth error enrichment, beta field stripping
- `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/providers/openai_compat.rs` -- `OpenAiCompatClient`, `OpenAiCompatConfig`, `openai_compat::MessageStream`, `StreamState`, `ToolCallState`, request translation (`build_chat_completion_request`, `translate_message`), response normalization, reasoning model detection, kimi compatibility, tool message sanitization, request body size checking, routing prefix stripping
