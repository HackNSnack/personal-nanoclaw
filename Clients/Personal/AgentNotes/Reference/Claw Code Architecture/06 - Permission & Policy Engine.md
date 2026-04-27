# 06 — Permission & Policy Engine

> Claw Code architecture investigation — Permission model, policy evaluation, bash validation, sandbox enforcement, and trust resolution.

---

## Summary

The permission and policy engine is a multi-layered security subsystem spanning six source files in the `runtime` crate. It enforces access control through a hierarchical permission mode system (`ReadOnly` < `WorkspaceWrite` < `DangerFullAccess` < `Prompt` < `Allow`), configurable allow/deny/ask rule lists parsed from `RuntimePermissionRuleConfig`, hook-driven overrides via `PermissionContext`, and interactive user prompting via the `PermissionPrompter` trait. Bash commands receive special treatment through two parallel classification systems: a lightweight heuristic in `permission_enforcer.rs` and a comprehensive six-stage validation pipeline in `bash_validation.rs` that classifies command intent and blocks/warns based on semantic analysis. Sandbox enforcement uses Linux `unshare` namespaces with container detection, and trust resolution gates workspace access via allowlisted/denied path roots.

---

## Key Types & Structs

### Permission Core (`runtime/src/permissions.rs`)

| Type | Role |
|---|---|
| `PermissionMode` | Enum with ordered variants: `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess`, `Prompt`, `Allow`. Implements `PartialOrd`/`Ord` — `ReadOnly` is the lowest, `Allow` is the highest. The ordering is used for mode comparison (`current_mode >= required_mode`). |
| `PermissionOverride` | Hook-provided override: `Allow`, `Deny`, `Ask`. Injected via `PermissionContext` before standard evaluation. |
| `PermissionContext` | Carries `override_decision: Option<PermissionOverride>` and `override_reason: Option<String>`. Built from hook results in the conversation loop (doc 04). |
| `PermissionRequest` | Full authorization request shown to the user: `tool_name`, `input`, `current_mode`, `required_mode`, `reason`. |
| `PermissionPromptDecision` | User's response: `Allow` or `Deny { reason }`. |
| `PermissionPrompter` (trait) | Single method `decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision`. The CLI implements this as `CliPermissionPrompter` (doc 04). |
| `PermissionOutcome` | Final result: `Allow` or `Deny { reason }`. |
| `PermissionPolicy` | Central evaluator. Holds: `active_mode`, `tool_requirements: BTreeMap<String, PermissionMode>`, `allow_rules`, `deny_rules`, `ask_rules` (all `Vec<PermissionRule>`). |
| `PermissionRule` (private) | Parsed rule with `raw: String`, `tool_name: String`, `matcher: PermissionRuleMatcher`. |
| `PermissionRuleMatcher` (private) | `Any` (bare tool name), `Exact(String)` (exact subject match), `Prefix(String)` (subject prefix with `:*` suffix). |

### Permission Enforcer (`runtime/src/permission_enforcer.rs`)

| Type | Role |
|---|---|
| `EnforcementResult` | Serde-tagged enum: `Allowed` or `Denied { tool, active_mode, required_mode, reason }`. |
| `PermissionEnforcer` | Wraps a `PermissionPolicy`. Provides `check()`, `is_allowed()`, `check_with_required_mode()`, `check_file_write()`, `check_bash()`. Used by the tool dispatch layer (doc 05) as the pre-execution gate. |

### Bash Validation (`runtime/src/bash_validation.rs`)

| Type | Role |
|---|---|
| `ValidationResult` | `Allow`, `Block { reason }`, `Warn { message }`. Three-state outcome (stricter than `PermissionOutcome`'s two-state). |
| `CommandIntent` | Semantic classification: `ReadOnly`, `Write`, `Destructive`, `Network`, `ProcessManagement`, `PackageManagement`, `SystemAdmin`, `Unknown`. |

### Policy Engine (`runtime/src/policy_engine.rs`)

| Type | Role |
|---|---|
| `PolicyEngine` | Rule-based engine for lane lifecycle decisions. Holds `Vec<PolicyRule>` sorted by priority. NOT directly related to tool permissions — this is for multi-agent lane orchestration. |
| `PolicyRule` | `name`, `condition: PolicyCondition`, `action: PolicyAction`, `priority: u32`. |
| `PolicyCondition` | Combinators (`And`, `Or`) and leaf conditions (`GreenAt`, `StaleBranch`, `StartupBlocked`, `LaneCompleted`, `LaneReconciled`, `ReviewPassed`, `ScopedDiff`, `TimedOut`). |
| `PolicyAction` | Actions: `MergeToDev`, `MergeForward`, `RecoverOnce`, `Escalate`, `CloseoutLane`, `CleanupSession`, `Reconcile`, `Notify`, `Block`, `Chain`. |
| `LaneContext` | Evaluation context with `lane_id`, `green_level`, `branch_freshness`, `blocker`, `review_status`, `diff_scope`, `completed`, `reconciled`. |

### Trust Resolution (`runtime/src/trust_resolver.rs`)

| Type | Role |
|---|---|
| `TrustPolicy` | `AutoTrust`, `RequireApproval`, `Deny`. |
| `TrustEvent` | Events: `TrustRequired { cwd }`, `TrustResolved { cwd, policy }`, `TrustDenied { cwd, reason }`. |
| `TrustConfig` | Holds `allowlisted: Vec<PathBuf>` and `denied: Vec<PathBuf>`. |
| `TrustDecision` | `NotRequired` or `Required { policy, events }`. |
| `TrustResolver` | Wraps `TrustConfig`. Methods: `resolve(cwd, screen_text)`, `trusts(cwd)`. |

### Sandbox (`runtime/src/sandbox.rs`)

| Type | Role |
|---|---|
| `FilesystemIsolationMode` | `Off`, `WorkspaceOnly` (default), `AllowList`. |
| `SandboxConfig` | Serializable config: `enabled`, `namespace_restrictions`, `network_isolation`, `filesystem_mode`, `allowed_mounts`. |
| `SandboxRequest` | Resolved (non-optional) request after merging config + overrides. |
| `ContainerEnvironment` | `in_container: bool`, `markers: Vec<String>`. |
| `SandboxStatus` | Full status: enabled, active, supported flags for namespace/network/filesystem, container markers, fallback reasons. |
| `SandboxDetectionInputs` | Testable inputs: env vars, dockerenv/containerenv existence, proc cgroup content. |
| `LinuxSandboxCommand` | Ready-to-execute `unshare` command: `program`, `args`, `env`. |

### Configuration Types (`runtime/src/config.rs`)

| Type | Role |
|---|---|
| `ResolvedPermissionMode` | Config-level enum: `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess`. Note: does NOT include `Prompt` or `Allow` — those are runtime-only modes. |
| `RuntimePermissionRuleConfig` | Three `Vec<String>` lists: `allow`, `deny`, `ask`. Parsed from merged config JSON. |
| `RuntimeFeatureConfig` | Top-level feature config containing `permission_mode`, `permission_rules`, `sandbox`, `trusted_roots`, plus hooks/plugins/MCP/etc. |
| `RuntimeConfig` | Fully merged config with `feature_config: RuntimeFeatureConfig`. Exposes `permission_mode()`, `permission_rules()`, `sandbox()`, `trusted_roots()`. |

---

## Permission Model

### Permission Modes (ordered from least to most permissive)

1. **`ReadOnly`** — Only read operations allowed. File writes, bash mutations, package installs all blocked.
2. **`WorkspaceWrite`** — Read + write within the workspace boundary. Writes outside the workspace root are denied. Bash commands that write are generally allowed if they target workspace paths.
3. **`DangerFullAccess`** — Full filesystem and system access. No workspace boundary restrictions.
4. **`Prompt`** — Interactive mode. The enforcer defers to the conversation loop's `PermissionPrompter` for every action that needs approval. The `PermissionEnforcer.check()` returns `Allowed` when mode is `Prompt` (it trusts the higher-level loop to prompt the user).
5. **`Allow`** — Everything permitted unconditionally. No checks, no prompts.

### How Modes Are Set

- **Config-level**: `ResolvedPermissionMode` (from `RuntimeFeatureConfig.permission_mode`) only has three variants: `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess`. This maps to what the user configures in their settings.
- **Runtime-level**: `PermissionMode` adds `Prompt` and `Allow` on top. These are set by CLI flags (e.g., `--accept-all` → `Allow`) or runtime construction.
- The `PermissionPolicy` is constructed with an `active_mode` and per-tool `tool_requirements` (a `BTreeMap<String, PermissionMode>` mapping tool names to their minimum required mode).

### Per-Tool Requirements

Each tool has a `required_permission: PermissionMode` in its `ToolSpec` (doc 05). If no explicit requirement is registered in the policy, the default is `DangerFullAccess` (the most restrictive fallback):

```rust
pub fn required_mode_for(&self, tool_name: &str) -> PermissionMode {
    self.tool_requirements.get(tool_name).copied()
        .unwrap_or(PermissionMode::DangerFullAccess)
}
```

### Permission Rules

Rules are parsed from `RuntimePermissionRuleConfig` (which comes from merged JSON config files). Three rule lists exist:

- **`allow`** — If matched, the tool is allowed without prompting (even if mode would otherwise deny).
- **`deny`** — If matched, the tool is unconditionally denied (checked first, highest priority).
- **`ask`** — If matched, the tool requires interactive approval even if mode would otherwise allow.

#### Rule Syntax

Rules are strings of the form `tool_name(subject_matcher)`:

- `bash` — Matches tool "bash" with any input (`PermissionRuleMatcher::Any`).
- `bash(git:*)` — Matches tool "bash" where the extracted subject starts with "git" (`PermissionRuleMatcher::Prefix`).
- `bash(git status)` — Matches tool "bash" where the extracted subject is exactly "git status" (`PermissionRuleMatcher::Exact`).
- Parentheses can be escaped with `\(` and `\)` for literal matching.

#### Subject Extraction

`extract_permission_subject()` parses the tool input as JSON and extracts the first matching key from: `command`, `path`, `file_path`, `filePath`, `notebook_path`, `notebookPath`, `url`, `pattern`, `code`, `message`. If none match, the raw input string is used. This means:
- For bash: the `command` field is the subject.
- For file tools: the `file_path` or `path` field is the subject.
- For web tools: the `url` field is the subject.

---

## Policy Evaluation Flow

### Primary Path: `PermissionPolicy::authorize_with_context()`

This is called from the conversation loop (doc 04, step 6d) for every tool use. The decision tree is:

```
1. Check DENY rules first
   → If any deny rule matches: DENY (immediate, no override possible)

2. Read context overrides (from hooks)
   → PermissionOverride::Deny: DENY with hook reason
   → PermissionOverride::Ask: PROMPT user (even if mode allows)
   → PermissionOverride::Allow:
       a. If ASK rule matches: PROMPT (ask rules override hook Allow)
       b. If ALLOW rule matches OR mode is Allow OR mode >= required: ALLOW
       c. Otherwise: fall through to standard evaluation

3. Standard evaluation (no override or Override::None):
   a. If ASK rule matches: PROMPT user
   b. If ALLOW rule matches OR mode is Allow OR mode >= required: ALLOW
   c. If mode is Prompt, or (mode is WorkspaceWrite and required is DangerFullAccess): PROMPT user
   d. Otherwise: DENY (insufficient permissions)
```

### Key Design Decisions

- **Deny rules are absolute** — They cannot be overridden by hooks, allow rules, or mode. Checked first.
- **Ask rules override hook Allow** — Even if a hook says "allow", an ask rule will still force prompting. This ensures security-sensitive operations always get human confirmation.
- **Hook Deny overrides everything except deny rules** — A hook can block a tool even if the mode would allow it.
- **Prompt mode defers** — When `active_mode == Prompt`, the `PermissionEnforcer.check()` returns `Allowed` immediately, trusting the conversation loop to handle prompting via `PermissionPolicy.authorize_with_context()` with a real `PermissionPrompter`.
- **No prompter = auto-deny** — When prompting is required but no `PermissionPrompter` is provided (e.g., background agents), the result is `Deny`.

### Two-Layer Architecture

There are **two distinct permission check layers** that execute at different points:

1. **`PermissionPolicy.authorize_with_context()`** — Called in the **conversation loop** (doc 04), supports hooks, rules, prompting. This is the primary, full-featured check.

2. **`PermissionEnforcer.check()`** — Called in the **tool dispatch layer** (doc 05, `execute_tool_with_enforcer()`), a simpler check without hooks or prompting. It delegates to `PermissionPolicy.authorize()` (no context, no prompter). When mode is `Prompt`, it returns `Allowed` to defer to the conversation loop layer.

This means permission is checked twice for most tools:
- First in the conversation loop (with hooks, rules, and prompting).
- Then in the tool executor (a simpler guard, mainly for sub-agents and direct tool invocations).

---

## Bash Validation

Bash commands receive the most elaborate security treatment, with validation spread across three files.

### Layer 1: Permission Classification (`tools/src/lib.rs::classify_bash_permission()`)

Before the `PermissionEnforcer` check, bash commands are dynamically classified to determine their required permission mode:

```
Input: bash command string
Output: PermissionMode (WorkspaceWrite or DangerFullAccess)
```

**Classification logic:**
1. Extract base command (first word, strip path prefix).
2. Check against `READ_ONLY_COMMANDS` list (26 commands: `cat`, `head`, `tail`, `less`, `more`, `ls`, `ll`, `dir`, `find`, `test`, `[`, `[[`, `grep`, `rg`, `awk`, `sed`, `file`, `stat`, `readlink`, `wc`, `sort`, `uniq`, `cut`, `tr`, `pwd`, `echo`, `printf`).
3. If NOT read-only: return `DangerFullAccess`.
4. If read-only: check `has_dangerous_paths()` — scans tokens for absolute paths outside CWD or `../..` traversals.
5. If paths are safe: return `WorkspaceWrite` (downgraded).
6. If paths are dangerous: return `DangerFullAccess`.

This classification feeds into `PermissionEnforcer.check_with_required_mode()`, which compares the dynamically determined required mode against the active mode.

### Layer 2: Enforcer Heuristics (`runtime/src/permission_enforcer.rs`)

`PermissionEnforcer.check_bash()` applies a separate, simpler heuristic:

| Active Mode | Behavior |
|---|---|
| `ReadOnly` | Allowed only if `is_read_only_command()` returns true (conservative whitelist of ~60 commands, rejects if `-i`, `--in-place`, `>`, `>>` are present) |
| `Prompt` | Always denied with "bash requires confirmation in prompt mode" |
| `WorkspaceWrite`, `DangerFullAccess`, `Allow` | Always allowed |

`is_read_only_command()` is more conservative than `classify_bash_permission()` — it includes more commands in its whitelist (e.g., `python3`, `node`, `ruby`, `cargo`, `rustc`, `git`, `gh`) but also checks for output redirection operators and in-place flags.

### Layer 3: Full Validation Pipeline (`runtime/src/bash_validation.rs`)

`validate_command()` runs a four-stage pipeline, returning the first non-Allow result:

**Stage 1: Mode Validation (`validate_mode()`)**
- `ReadOnly` mode: delegates to `validate_read_only()`:
  - Blocks `WRITE_COMMANDS` (17 commands: `cp`, `mv`, `rm`, `mkdir`, `rmdir`, `touch`, `chmod`, `chown`, `chgrp`, `ln`, `install`, `tee`, `truncate`, `shred`, `mkfifo`, `mknod`, `dd`).
  - Blocks `STATE_MODIFYING_COMMANDS` (34 commands: package managers, Docker, systemctl, kill, user management, etc.).
  - Blocks write redirections (`>`, `>>`, `>&`).
  - Recursively unwraps `sudo` to check the inner command.
  - For `git`: allows only `GIT_READ_ONLY_SUBCOMMANDS` (18 subcommands: `status`, `log`, `diff`, `show`, `branch`, `tag`, `stash`, `remote`, `fetch`, `ls-files`, `ls-tree`, `cat-file`, `rev-parse`, `describe`, `shortlog`, `blame`, `bisect`, `reflog`, `config`).
- `WorkspaceWrite` mode: checks `command_targets_outside_workspace()` — if a write command references system paths (`/etc/`, `/usr/`, `/var/`, `/boot/`, `/sys/`, `/proc/`, `/dev/`, `/sbin/`, `/lib/`, `/opt/`), emits `Warn`.
- `DangerFullAccess`, `Allow`, `Prompt`: always `Allow`.

**Stage 2: Sed Validation (`validate_sed()`)**
- Blocks `sed -i` (in-place editing) in `ReadOnly` mode.

**Stage 3: Destructive Command Detection (`check_destructive()`)**
- Pattern-matches against 10 known destructive patterns: `rm -rf /`, `rm -rf ~`, `rm -rf *`, `rm -rf .`, `mkfs`, `dd if=`, `> /dev/sd`, `chmod -R 777`, `chmod -R 000`, fork bomb `:(){ :|:& };:`.
- Checks `ALWAYS_DESTRUCTIVE_COMMANDS`: `shred`, `wipefs`.
- Catches any remaining `rm -rf` pattern as a general warning.
- Returns `Warn` (not `Block`) — this is advisory, not enforced.

**Stage 4: Path Validation (`validate_paths()`)**
- Warns on `../` directory traversal that doesn't resolve within the workspace.
- Warns on `~/` or `$HOME` references.

### Semantic Classification (`classify_command()`)

Separate from the validation pipeline, `classify_command()` assigns a `CommandIntent` to a command:

| Intent | Matching Commands |
|---|---|
| `ReadOnly` | 57 commands (ls, cat, head, tail, less, more, wc, sort, uniq, grep, find, etc.) + `sed` without `-i` + git read-only subcommands |
| `Write` | `WRITE_COMMANDS` (cp, mv, mkdir, etc.) + `sed -i` + git write subcommands |
| `Destructive` | `rm` (always), `shred`, `wipefs` |
| `Network` | 21 commands (curl, wget, ssh, scp, rsync, etc.) |
| `ProcessManagement` | 14 commands (kill, pkill, ps, top, etc.) |
| `PackageManagement` | 18 commands (apt, brew, pip, npm, cargo, etc.) |
| `SystemAdmin` | 27 commands (sudo, mount, systemctl, iptables, useradd, etc.) |
| `Unknown` | Everything else |

Helper `extract_first_command()` strips leading `KEY=val` environment variable assignments before identifying the command name.

---

## Sandbox & Trust

### Container Detection (`sandbox.rs`)

`detect_container_environment()` checks three signal sources:

1. **Sentinel files**: `/.dockerenv`, `/run/.containerenv`.
2. **Environment variables**: `container`, `docker`, `podman`, `KUBERNETES_SERVICE_HOST` (case-insensitive key match).
3. **Cgroup file** (`/proc/1/cgroup`): scans for strings `docker`, `containerd`, `kubepods`, `podman`, `libpod`.

All detected markers are collected, sorted, and deduplicated. `in_container` is true if any marker is found.

A pure-function variant `detect_container_environment_from()` accepts `SandboxDetectionInputs` for testability.

### Sandbox Configuration and Resolution

`SandboxConfig` (from `RuntimeFeatureConfig.sandbox`) provides five options, all overridable:
- `enabled` (default: `true`)
- `namespace_restrictions` (default: `true`)
- `network_isolation` (default: `false`)
- `filesystem_mode` (default: `WorkspaceOnly`)
- `allowed_mounts` (default: `[]`)

`resolve_sandbox_status()` produces a `SandboxStatus` by:
1. Resolving the `SandboxRequest` from config + overrides.
2. Detecting the container environment.
3. Checking `unshare_user_namespace_works()` — a cached (`OnceLock`) probe that actually runs `unshare --user --map-root-user true` to test if user namespaces work (they may not on GitHub Actions or restricted kernels).
4. Computing active flags: namespace/network active only if requested AND supported.
5. Collecting fallback reasons if requested features are unavailable.

### Linux Sandbox Command

`build_linux_sandbox_command()` produces an `unshare` invocation when sandboxing is enabled and active on Linux:

```
unshare --user --map-root-user --mount --ipc --pid --uts --fork [--net] sh -lc "<command>"
```

Environment variables set:
- `HOME` → `<cwd>/.sandbox-home`
- `TMPDIR` → `<cwd>/.sandbox-tmp`
- `CLAWD_SANDBOX_FILESYSTEM_MODE` → the active filesystem isolation mode
- `CLAWD_SANDBOX_ALLOWED_MOUNTS` → colon-separated list of normalized mount paths
- `PATH` → inherited from host

Returns `None` on non-Linux platforms, when sandbox is disabled, or when neither namespace nor network isolation is active.

### Filesystem Isolation Modes

| Mode | Behavior |
|---|---|
| `Off` | No filesystem restrictions. |
| `WorkspaceOnly` (default) | Restricts filesystem access to the workspace directory. Communicated via env vars to the sandboxed process. |
| `AllowList` | Only explicitly listed mount paths are accessible. Falls back with a warning if `allowed_mounts` is empty. |

### Trust Resolution (`trust_resolver.rs`)

The `TrustResolver` handles workspace trust prompts — determining whether to auto-approve, deny, or require manual approval when a trust prompt is detected.

**Trust Prompt Detection:**
`detect_trust_prompt()` scans screen text (case-insensitive) for any of five cue strings:
- "do you trust the files in this folder"
- "trust the files in this folder"
- "trust this folder"
- "allow and continue"
- "yes, proceed"

**Resolution Flow (`TrustResolver::resolve()`):**
1. If no trust prompt is detected in the screen text: return `NotRequired`.
2. Emit `TrustRequired { cwd }` event.
3. Check `denied` roots first (takes precedence): if `cwd` matches a denied root, return `Deny` with a `TrustDenied` event.
4. Check `allowlisted` roots: if `cwd` matches an allowlisted root, return `AutoTrust` with a `TrustResolved` event.
5. Otherwise: return `RequireApproval` (manual user confirmation needed).

**Path Matching:**
`path_matches()` canonicalizes both candidate and root paths (`std::fs::canonicalize`, falling back to raw path), then checks if the candidate equals or starts with the root. This handles symlinks but may produce spurious failures for non-existent paths.

**Convenience:** `TrustResolver::trusts(cwd)` returns `true` only if the cwd is in the allowlist and NOT in the denied list (no prompt detection needed).

---

## Policy Engine (Lane Orchestration)

**Important distinction:** The `PolicyEngine` in `policy_engine.rs` is NOT part of the tool permission system. It is a rule-based decision engine for multi-agent lane lifecycle management, used by the lane completion system (`lane_completion.rs` in the tools crate, doc 05).

It evaluates `PolicyRule`s against a `LaneContext` and produces `PolicyAction`s. Rules are sorted by priority (lower = higher priority) and all matching rules fire (not just the first match). `Chain` actions are recursively flattened into a flat action list.

Key conditions: `GreenAt { level }` (CI green level threshold), `StaleBranch` (1 hour freshness), `LaneCompleted`, `LaneReconciled`, `ReviewPassed`, `ScopedDiff`.

Key actions: `MergeToDev`, `MergeForward`, `RecoverOnce`, `Escalate`, `CloseoutLane`, `CleanupSession`, `Reconcile { reason }`, `Notify { channel }`.

---

## Integration Points

### With Conversation Loop (doc 04)

- **`PermissionPolicy`** is stored in `ConversationRuntime.permission_policy` (doc 04).
- **`authorize_with_context()`** is called for each tool use in the conversation loop (doc 04, step 6d), after pre-tool hooks run and build a `PermissionContext`.
- **`CliPermissionPrompter`** is passed as the `PermissionPrompter` from the CLI layer. When running without a prompter (e.g., sub-agents), `prompter` is `None` and any prompt-required decision auto-denies.
- **`PermissionOverride`** values (`Allow`, `Deny`, `Ask`) are produced by pre-tool hooks and injected into the `PermissionContext` that feeds `authorize_with_context()`.
- **Denied tools do NOT stop the loop** — the denial message is returned as an error tool result, and the model sees it and may retry or respond with text.

### With Tool Execution (doc 05)

- **`PermissionEnforcer`** is held by `GlobalToolRegistry` (doc 05, via `with_enforcer()`).
- **`execute_tool_with_enforcer()`** calls `maybe_enforce_permission_check()` or `maybe_enforce_permission_check_with_mode()` before each tool handler runs.
- **Bash/PowerShell get dynamic classification**: `classify_bash_permission()` determines the required mode before calling `check_with_required_mode()`.
- **Most tools use static permission**: Their `ToolSpec.required_permission` is registered in the policy's `tool_requirements` map.
- **Sub-agent enforcement**: `SubagentToolExecutor` (doc 05) also holds an optional `PermissionEnforcer` and passes it through the same dispatch path.

### With Configuration (doc 01)

- **`RuntimePermissionRuleConfig`** carries the three rule lists (`allow`, `deny`, `ask`) from merged config files.
- **`PermissionPolicy::with_permission_rules()`** parses these string rules into `PermissionRule` structs at policy construction time.
- **`ResolvedPermissionMode`** from `RuntimeConfig.permission_mode()` maps to `PermissionMode` variants (without `Prompt`/`Allow` which are runtime-only).
- **`SandboxConfig`** from `RuntimeConfig.sandbox()` configures sandbox behavior.
- **`trusted_roots`** from `RuntimeConfig.trusted_roots()` feeds into `TrustConfig.allowlisted`.

### With System Prompt (doc 03)

- The system prompt includes the permission mode description, informing the model of its current access level.
- Tool definitions sent to the API (doc 02) include all registered tools regardless of permission mode — permission is enforced at execution time, not at the manifest level.

---

## Open Questions

1. **Two parallel bash classification systems**: `classify_bash_permission()` in `tools/lib.rs` and `is_read_only_command()` in `permission_enforcer.rs` have overlapping but different command lists. `classify_bash_permission()` has 26 read-only commands; `is_read_only_command()` has ~60 commands including `python3`, `node`, `ruby`, `cargo`, `rustc`, `git`, `gh`. Which one takes precedence depends on the call path — the tools layer uses `classify_bash_permission()`, while `check_bash()` in the enforcer uses `is_read_only_command()`. This could lead to inconsistent behavior.

2. **bash_validation.rs appears unused in the dispatch path**: The comprehensive `validate_command()` pipeline in `bash_validation.rs` is not called from `execute_tool_with_enforcer()` or from the conversation loop. It may be intended for a future integration or used from a path not yet investigated. Currently, bash permission is handled by `classify_bash_permission()` + `PermissionEnforcer`, not by the `bash_validation` module.

3. **Double permission check**: Tool permissions are checked both in the conversation loop (`PermissionPolicy.authorize_with_context()`) and in the tool executor (`PermissionEnforcer.check()`). When mode is `Prompt`, the enforcer returns `Allowed` to defer to the loop — but this means the enforcer is a no-op in `Prompt` mode. Is the enforcer check redundant or is it a defense-in-depth measure for non-standard call paths?

4. **PolicyEngine is disconnected from tool permissions**: The `PolicyEngine` in `policy_engine.rs` handles lane lifecycle (merge, escalate, closeout) rather than tool permissions. Its name might suggest otherwise. The naming could be confusing when navigating the codebase.

5. **`PermissionMode` ordering includes `Prompt` and `Allow`**: Since `PermissionMode` derives `PartialOrd`/`Ord`, the variant order matters: `ReadOnly(0) < WorkspaceWrite(1) < DangerFullAccess(2) < Prompt(3) < Allow(4)`. This means `Prompt >= DangerFullAccess` is true, and `Allow >= DangerFullAccess` is true. The `authorize_with_context()` method relies on `current_mode >= required_mode` — so `Prompt` mode passes this check for `DangerFullAccess` tools, which is why it then needs the special case to prompt the user.

6. **Trust resolver is UI-coupled**: `TrustResolver::resolve()` takes `screen_text` and pattern-matches against English-language prompt cues. This tightly couples the resolver to the specific UI text of trust prompts. If the prompt text changes, the cue list must be updated manually.

7. **Sandbox unshare probe runs once**: The `unshare_user_namespace_works()` function caches its result in a `OnceLock`. If the system state changes during runtime (unlikely but possible in containerized environments), the cached result could be stale.

8. **`check_file_write` in Prompt mode returns Denied**: Unlike `check()` which returns `Allowed` in `Prompt` mode (deferring to the loop), `check_file_write()` returns `Denied` in `Prompt` mode with "file write requires confirmation in prompt mode". This inconsistency means file writes and bash commands handle `Prompt` mode differently in the enforcer.

9. **Path validation uses string matching, not canonicalization**: `is_within_workspace()` in `permission_enforcer.rs` uses string prefix matching, not `Path::starts_with()`. Symlinks, `..` components, and trailing slashes could bypass the check. The `trust_resolver.rs` does use `fs::canonicalize()` but falls back to raw paths if canonicalization fails.

10. **`extract_permission_subject()` key order determines matching**: The subject extraction function checks keys in a fixed order (`command`, `path`, `file_path`, ...). If a tool input has both `command` and `path` fields, only `command` is used for rule matching. This could lead to unexpected rule behavior for tools with multiple relevant fields.

---

## Key Files Read

| File | Absolute Path | Lines | Purpose |
|---|---|---|---|
| permissions.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/permissions.rs` | 683 | Permission types, modes, rules, policy evaluation, prompter trait |
| permission_enforcer.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/permission_enforcer.rs` | 585 | Enforcement layer wrapping PermissionPolicy, bash/file checks |
| policy_engine.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/policy_engine.rs` | 581 | Lane lifecycle policy engine (not tool permissions) |
| trust_resolver.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/trust_resolver.rs` | 299 | Trust prompt detection, allowlist/denylist resolution |
| sandbox.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/sandbox.rs` | 385 | Container detection, sandbox config resolution, unshare command building |
| bash_validation.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/bash_validation.rs` | 1004 | Six-stage bash validation pipeline, command classification |
| config.rs (partial) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/config.rs` | (partial) | ResolvedPermissionMode, RuntimePermissionRuleConfig, RuntimeFeatureConfig |
| lib.rs (tools, partial) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/tools/src/lib.rs` | (partial) | classify_bash_permission, execute_tool_with_enforcer, enforce_permission_check |
