# 08 — Compaction & Context Management

## Summary

Compaction (~840 LOC) summarizes older conversation messages when context grows too large. It finds a cut point in the message history, sends everything before it to the LLM for summarization, and replaces those messages with a `CompactionEntry`. The system supports three triggers: manual (`/compact`), proactive threshold, and reactive context overflow recovery. Branch summarization is a separate feature that summarizes abandoned branches during tree navigation.

## Key Types & Interfaces

| Type | Description |
|---|---|
| `CompactionPreparation` | `{cutIndex, messagesBeforeCut, messagesAfterCut, contextTokensBefore}` |
| `CompactionResult` | `{summary, messagesCompacted, contextTokensBefore, contextTokensAfter}` |
| `CompactionEntry` | Session entry: `{type: "compaction", summary, messagesCompacted, timestamp}` |

## Flow

### Compaction Pipeline

```
1. TRIGGER:
   - Manual: /compact [instructions]
   - Threshold: estimateContextTokens() > contextWindow * compactThreshold (default 0.8)
   - Overflow: context_overflow error from provider → compact + retry

2. PREPARE:
   prepareCompaction(messages, model, retention?):
   a. Find cut point: scan from end backwards
      - Must be after a complete tool-use cycle (assistant + all tool results)
      - Must leave at least `retention` recent messages (default from settings)
      - Cannot cut inside a tool call sequence
   b. Return: {cutIndex, messagesBeforeCut, messagesAfterCut, contextTokensBefore}

3. EXTENSION HOOK:
   session_before_compact event → extensions can:
   - Cancel: {cancel: true}
   - Provide custom compaction: {compaction: CompactionResult}
   - Modify preparation

4. SUMMARIZE:
   compact(preparation, model, streamFn, options?):
   a. Build summarization prompt from messagesBeforeCut
   b. Send to LLM for summarization
   c. Return: {summary, messagesCompacted, contextTokensBefore, contextTokensAfter}

5. APPLY:
   a. Create CompactionEntry with summary
   b. Append to session
   c. Replace agent.state.messages: [compactionSummary, ...messagesAfterCut]
   d. Emit session_compact event

6. RETRY (overflow only):
   After compaction, retry the failed LLM call
```

### Cut Point Selection

The cut point must satisfy:
- After a complete assistant response + all its tool results
- Leaves enough recent messages for context (configurable retention)
- Scans backward from the end to find the latest valid cut point

```
messages: [user, assistant(tools), toolResult, toolResult, user, assistant, user, assistant(tools), toolResult]
                                                                     ^--- valid cut point (after complete turn)
                                                    ^--- also valid
```

### Token Estimation

```
estimateContextTokens(messages, model):
  Heuristic: ~4 chars per token (rough approximation)
  Used for threshold checks, not exact counting
  Accuracy varies by model/language

calculateContextTokens(messages, model):
  Sum of actual usage.input from assistant messages
  More accurate but only available after LLM responses
```

### Branch Summarization

```
generateBranchSummary(entries, model, streamFn, options?):
  1. Collect entries from abandoned branch
  2. Build summarization prompt
  3. Send to LLM
  4. Return: {summary, details}
  5. Create BranchSummaryEntry in session
```

Triggered during `/tree` navigation when leaving a branch.

## Settings

| Setting | Default | Description |
|---|---|---|
| `autoCompact` | `true` | Enable proactive compaction |
| `compactThreshold` | `0.8` | Context usage ratio to trigger compaction |
| `compactMessageRetention` | varies | Min recent messages to preserve |
| `branchSummary` | `true` | Enable branch summarization on tree navigation |

## Integration Points

| Connects to | How |
|---|---|
| **Agent Session (doc 04)** | Session triggers compaction on threshold/overflow; applies result to agent state |
| **Session Management (doc 07)** | `CompactionEntry` and `BranchSummaryEntry` persisted to session |
| **Extension System (doc 06)** | `session_before_compact` can cancel or customize; `session_compact` notifies |
| **AI Provider (doc 02)** | Uses LLM to generate summaries; token estimation from model metadata |

## Extension Relevance

- **`session_before_compact`**: Intercept compaction. Return `{cancel: true}` to prevent, or `{compaction: result}` with custom summary.
- **`ctx.compact({customInstructions?})`**: Trigger compaction programmatically from an extension.
- **Custom compaction strategy**: Provide a `session_before_compact` handler that generates its own summary (e.g., using a cheaper model, or extracting structured state).
- **Compaction awareness**: After compaction, messages before the cut point are gone. Extensions storing references to message IDs should handle this gracefully.

## Open Questions

1. **Token estimation accuracy**: The 4-chars-per-token heuristic is rough. Does this cause premature or late compaction?
2. **Compaction model**: Always uses the current model. Could a cheaper/faster model be specified for summarization?
3. **Incremental compaction**: Each compaction is all-or-nothing. Could incremental summarization reduce work?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/compaction/compaction.ts` | 839 | Core compaction logic, cut point selection, summarization |
| `coding-agent/src/core/compaction/branch-summarization.ts` | ~200 | Branch summary generation |
| `coding-agent/src/core/compaction/utils.ts` | ~100 | Token estimation utilities |
| `coding-agent/src/core/compaction/index.ts` | ~30 | Re-exports |
