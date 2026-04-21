---
tags: [pidev, configuration, setup]
type: reference
status: in-progress
created: 2026-04-21
---

# Pi.dev - Configuration

Current configuration state and changes made to `~/.pi/agent/` setup.

## Current Location

Working directory: `/home/mathipe/.pi`

## Configuration Files

### Context Files

| File | Purpose | Status |
|------|---------|--------|
| `AGENTS.md` / `CLAUDE.md` | Project instructions loaded at startup | To review |
| `SYSTEM.md` | Replaces default system prompt | To review |
| `APPEND_SYSTEM.md` | Appends to system prompt | To review |

### Settings

| File | Purpose | Status |
|------|---------|--------|
| `settings.json` | Global configuration | To review |
| `models.json` | Custom model definitions | To review |
| `keybindings.json` | Keyboard shortcuts | To review |

## Planned Changes

_Document configuration changes as we make them_

## Related Notes

- [[PiDev/Overview]]
- [[PiDev/Extensions]]


## Git Repository Setup

**Date**: 2026-04-21

Initialized git repository for Pi configuration tracking:

1. **Repository created**: Private GitHub repo at https://github.com/HackNSnack/PiConfig
2. **Location**: `/home/mathipe/.pi`
3. **Branch**: `main`

### Files Tracked

- `.gitignore` - Standard exclusions for secrets, cache, sessions
- `agent/settings.json` - Global configuration
- `agent/permissions.json` - Permission settings
- `agent/extensions/` - Custom extensions (permissions system, billing)
- `agent/git/.gitignore` - Keeps git extensions ignored (pi.dev default)

### Files Ignored

- `agent/auth.json` - Authentication credentials
- `agent/sessions/` - Session data (may contain sensitive info)
- `agent/git/` contents - Extensions auto-installed, submodules not used
- `cache/`, `*.cache` - Cache files
- `*.key`, `*.pem` - Private keys
- `.claude/settings.local.json` - Local settings

### Notes

- Submodules deliberately not used - extensions are auto-installed
- `agent/git/.gitignore` contains `*` to ignore all cloned repos/extensions
- This is intentional per pi.dev defaults
