---
tags: [pidev, permissions, security, extensions]
type: work
status: done
created: 2026-04-21
---

# Pi Permission System

Custom project-scoped permission system for Pi with sensitive file protection.

## Implementation

**Location**: `~/.pi/agent/extensions/permissions/`

**Architecture**: Option 2.5 - Built from scratch, extracted classification logic from [pi-permission](https://github.com/SecKatie/pi-permission)

**Key Differences from pi-permission**:
- Project-scoped (not session-scoped)
- Sensitive file detection (top priority)
- 3-tier prompting (once/project/global)
- Hybrid grants (level + operation-specific)

## Features

### 3-Tier Prompting

When Pi requests permission:

```
Run command: npm install express
Classification: Medium

[ Allow once ]              → Execute this one time
[ Allow for this project ]  → Store in .pi/permissions.json
[ Allow globally ]          → Store in ~/.pi/agent/permissions.json
[ Cancel ]
```

### Sensitive File Protection

Automatically detects and prompts for:
- `.env*` files
- SSH keys (`~/.ssh/*`, `id_rsa*`, etc.)
- Certificates (`.pem`, `.key`, `.p12`)
- Credentials files
- Secrets, tokens, passwords
- AWS/GCP/Kubernetes configs
- History files (may contain secrets)

Full list: `src/sensitive-files.ts`

### Permission Levels

| Level | Description | Examples |
|-------|-------------|----------|
| `minimal` | Read-only (default) | ls, cat, grep, git status |
| `low` | File operations | write, edit files |
| `medium` | Dev operations | npm install, git commit, build |
| `high` | Full operations | git push, curl, docker |
| `bypassed` | All checks disabled | Everything (dangerous) |

### Hybrid Grant Model

**Level-based**: "Allow all MEDIUM operations"
**Operation-specific**: "Allow npm install"
**File patterns**: "Allow read src/**/*.py"

## Configuration

### Global Config

`~/.pi/agent/permissions.json`:

```json
{
  "defaultLevel": "minimal",
  "globalGrants": [],
  "sensitiveFilePatterns": ["**/.env*", "**/.ssh/*", ...]
}
```

### Project Config

`<project-root>/.pi/permissions.json`:

```json
{
  "projectGrants": [],
  "allowedSensitiveFiles": ["config/test-credentials.json"],
  "projectDefaultLevel": "medium"
}
```

## Permission Evaluation Flow

1. Dangerous commands (rm -rf, sudo) → **Always prompt**
2. Sensitive files → **Always prompt** (unless allowedSensitiveFiles)
3. "Once" grants (in-memory) → Allow
4. Project grants (`.pi/permissions.json`) → Allow
5. Global grants (`~/.pi/agent/permissions.json`) → Allow
6. Default level → Allow if operation level ≤ default
7. No match → Prompt

## Commands

- `/permissions` - Show current permissions
- `/permissions show` - Same as above
- `/permissions reset` - Reset permissions (prompts for scope)

## File Structure

```
~/.pi/agent/extensions/permissions/
├── src/
│   ├── index.ts              # Extension entry point
│   ├── types.ts              # Type definitions
│   ├── classification.ts     # Command classification (from pi-permission)
│   ├── sensitive-files.ts    # Sensitive file detection
│   ├── project-detection.ts  # Find project root
│   ├── storage.ts            # Permission I/O
│   ├── evaluation.ts         # Permission logic
│   └── prompts.ts            # UI prompting
├── dist/                     # Compiled JS (auto-generated)
├── package.json
├── tsconfig.json
├── README.md
└── TESTING.md
```

## Build

```bash
cd ~/.pi/agent/extensions/permissions
pnpm install
pnpm run build
```

## Testing

See `TESTING.md` for comprehensive test scenarios.

**Quick test**:
```bash
pi
> read ~/.ssh/id_rsa
```

Should prompt with sensitive file warning.

## Implementation Timeline

- **Phase 1**: Core infrastructure (types, storage, project detection) ✅
- **Phase 2**: Extract classification from pi-permission ✅
- **Phase 3**: Permission evaluation engine ✅
- **Phase 4**: 3-tier prompting UI ✅
- **Phase 5**: Extension hooks and integration ✅
- **Phase 6**: Build and testing ✅

**Total time**: ~4 hours

## Next Steps

- [ ] Test with real Pi session
- [ ] Adjust default sensitive file patterns if needed
- [ ] Consider adding operation-based grants for common workflows
- [ ] Maybe add path-based permissions later (deferred for now)

## Attribution

Command classification logic (~1400 test cases) extracted from [pi-permission](https://github.com/SecKatie/pi-permission) by SecKatie.

## Related

- [[Clients/Netlight/AgentNotes/Reference/PiDev/Overview]]
- [[Configuration]]


## UI Enhancements (2026-04-21)

### Number Key Shortcuts
**File**: `src/prompts.ts:100-163`

Press 1-4 to instantly select permission options:
```
Run command: npm install

1. Allow once
2. Allow for this project
3. Allow globally
4. Cancel
```

**Implementation**:
- `Promise.race()` between select dialog and terminal input listener
- `AbortController` dismisses dialog when number key pressed
- Prevents visual glitch where menu persists after selection

### Status Bar
**File**: `src/index.ts:56-81`

Shows current permission state in footer:
- Format: `🔒 Medium (2p) (5g)`
  - Lock icon + permission level
  - `(2p)` = project grant count
  - `(5g)` = global grant count
- Updates on: session start, grants added, reset
- Uses `ctx.ui.setStatus()` from Pi extension API

**Examples**:
- `🔒 Minimal` - No grants
- `🔒 Medium (3p)` - 3 project grants  
- `🔒 High (2p) (5g)` - 2 project + 5 global

## Known Issue: Hang When Used with Subagent Extension

> **Fixed**: 2026-07-10

### Problem

When the subagent extension spawns a child `pi` process and that child tries an operation requiring a permission prompt, the **parent session hangs indefinitely**.

### Cause

The child runs in `--mode json` (non-interactive). `ctx.hasUI` is `false`. `ctx.ui.select()` is a no-op that returns `undefined` immediately. The permission handlers interpret this as the user pressing "Cancel" and call **`ctx.abort()`**, which signals the child's agent AbortController mid-`beforeToolCall`. The child's next LLM HTTP request may not cancel immediately (the Anthropic provider only checks the abort signal at the end of its streaming loop), causing a full LLM round-trip delay or longer hang.

### Fix

Added `if (!ctx.hasUI) { return undefined; }` in all four handlers (`handleBashToolCall`, `handleReadToolCall`, `handleWriteToolCall`, `handleEditToolCall`) **before** the `promptForPermission()` call.

In non-interactive mode the extension now auto-allows any operation that would normally trigger a prompt. Hard `"deny"` decisions (sensitive files, commands above configured level) still block unconditionally.

**File**: `src/index.ts` — rebuild with `pnpm run build`

Full investigation: [[Subagent Extension]]
