# 07 — Session Management & Branching

## Summary

Sessions are persisted as JSONL files (~1,400 LOC in `session-manager.ts`) with a tree structure — each entry has an `id` and `parentId`, enabling in-place branching without duplicating data. The `SessionManager` class handles creation, persistence, tree navigation, forking, branch switching, and session listing. Sessions are stored under `~/.pi/agent/sessions/` organized by working directory hash.

## Key Types & Interfaces

| Type | Description |
|---|---|
| `SessionManager` | Core class. Methods: `create()`, `open()`, `inMemory()`, `forkFrom()`, `continueRecent()`, `list()`, `listAll()`, `findSession()`, `appendEntry()`, `getBranch()`, `getActiveLeafId()`, `setActiveLeafId()`, `getChildren()`, `getEntry()`, `buildSessionContext()` |
| `ReadonlySessionManager` | Read-only interface exposed to extensions |
| `SessionEntry` | Union of all entry types |
| `SessionHeader` | `{type: "session_header", version, cwd, createdAt, parentSession?, id}` |
| `SessionMessageEntry` | `{type: "session_message", id, parentId, message: AgentMessage, timestamp}` |
| `CompactionEntry` | `{type: "compaction", id, parentId, summary, messagesCompacted, timestamp}` |
| `BranchSummaryEntry` | `{type: "branch_summary", id, parentId, summary, details?, label?, timestamp}` |
| `ModelChangeEntry` | `{type: "model_change", id, parentId, model, previousModel, timestamp}` |
| `ThinkingLevelChangeEntry` | `{type: "thinking_level_change", id, parentId, level, previousLevel}` |
| `CustomEntry<T>` | `{type: "custom", id, parentId, customType, data?: T}` |
| `CustomMessageEntry<T>` | `{type: "custom_message", id, parentId, message: CustomMessage<T>}` |
| `LabelEntry` | `{type: "label", targetId, label}` (does not have parentId — metadata overlay) |
| `SessionInfoEntry` | `{type: "session_info", name?, ...}` (session metadata) |

## Flow

### Session File Format (JSONL)

```jsonl
{"type":"session_header","version":2,"cwd":"/home/user/project","createdAt":1234567890,"id":"abc123"}
{"type":"session_message","id":"msg1","parentId":"abc123","message":{"role":"user",...}}
{"type":"session_message","id":"msg2","parentId":"msg1","message":{"role":"assistant",...}}
{"type":"session_message","id":"msg3","parentId":"msg2","message":{"role":"toolResult",...}}
```

### Tree Structure

Entries form a tree via `parentId` chains. The "active branch" is the path from root to the active leaf:

```
root (session_header)
├── msg1 (user)
│   ├── msg2 (assistant) ← original response
│   │   └── msg3 (toolResult)
│   │       └── msg4 (assistant)
│   │           └── msg5 (user) ← branch A (active leaf)
│   └── msg6 (assistant) ← re-generated response
│       └── msg7 (user) ← branch B
```

Branching happens when you navigate back to an earlier entry and continue — new entries get a different `parentId`.

### Building Context

```
buildSessionContext(leafId?):
  1. Get active leaf (or specified leaf)
  2. Walk parentId chain to root → ordered list of entries
  3. Filter to AgentMessage entries (skip metadata)
  4. Return {messages: AgentMessage[], header}
```

### Forking

```
SessionManager.forkFrom(sourcePath, cwd, sessionDir):
  1. Read source session entries
  2. Create new session file
  3. Write header with parentSession reference
  4. Copy entries from root to active leaf
  5. Return new SessionManager
```

### Tree Navigation

```
AgentSession.navigateTree(targetId, options?):
  1. Emit session_before_tree (can be cancelled by extensions)
  2. If summarize: generate branch summary for abandoned entries
  3. Set active leaf to targetId
  4. Rebuild agent context from new branch
  5. Emit session_tree
```

### Session Storage Layout

```
~/.pi/agent/sessions/
├── <cwd-hash>/
│   ├── <session-id>.jsonl
│   ├── <session-id>.jsonl
│   └── ...
└── <another-cwd-hash>/
    └── ...
```

Custom session directory via `settings.sessionDir` or `--session-dir`.

## Integration Points

| Connects to | How |
|---|---|
| **Agent Session (doc 04)** | Session persists all agent events as entries; rebuilds context on branch switch |
| **Compaction (doc 08)** | `CompactionEntry` replaces summarized messages in the branch |
| **Extension System (doc 06)** | `session_start`, `session_shutdown`, `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_tree` events |
| **Bootstrap (doc 01)** | `createSessionManager()` resolves session from CLI args |
| **Modes (doc 10)** | Interactive mode: `/tree`, `/fork`, `/clone`, `/session` commands use SessionManager |

## Extension Relevance

- **`session_start`**: Fires on startup/reload/resume/fork. Use `event.reason` to differentiate. Reconstruct extension state from session entries here.
- **`session_shutdown`**: Fires before session teardown. Clean up resources.
- **`session_before_switch`**: Return `{cancel: true}` to prevent session switch.
- **`session_before_fork`**: Return `{cancel: true}` to prevent fork, or `{skipConversationRestore: true}` to fork without restoring conversation.
- **`session_before_tree`**: Control branch summarization or cancel navigation.
- **`pi.appendEntry(customType, data)`**: Persist extension state as `CustomEntry`. Not sent to LLM.
- **`ctx.sessionManager`**: Read-only access to session tree. Can inspect entries, branches, labels.
- **`pi.setLabel(entryId, label)`**: Bookmark entries for navigation.
- **`pi.setSessionName(name)`**: Set display name for session selector.

## Open Questions

1. **Concurrent writes**: JSONL append is not atomic. If two processes write simultaneously (unlikely but possible via SDK), entries could interleave.
2. **Session size limits**: No built-in pruning of old sessions. Large sessions (many branches) can grow indefinitely.
3. **Migration**: `CURRENT_SESSION_VERSION` is 2. What changed from v1? Is there auto-migration?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/session-manager.ts` | 1,425 | Full session management, tree structure, JSONL I/O |
