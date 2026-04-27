# MCPVault vs Current Obsidian MCP Setup — Comparison

> Created: 2026-04-27
> Location: Personal AgentNotes comparison of two Obsidian MCP implementations

## Architecture

| Aspect            | Current Setup (obsidian-mcp)                   | MCPVault                                                     |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| **Server type**   | HTTP server (`http://localhost:54321/mcp`)     | stdio server (CLI: `npx @bitbonsai/mcpvault /path/to/vault`) |
| **Transport**     | HTTP/JSON-RPC                                  | stdio (process-based)                                        |
| **Language**      | Python                                         | TypeScript                                                   |
| **Install**       | Python package (running as background process) | npm/npx (on-demand process)                                  |
| **Vault path**    | Configured in server (server-side)             | Passed as CLI arg each invocation                            |
| **Process model** | Long-running daemon on port 54321              | Ephemeral per-MCP-client process                             |

## MCP Tools — Feature Comparison

| Capability     | obsidian-mcp tools                                                   | MCPVault tools                                                   |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Read note      | `obsidian_mcp_get_file_contents`                                     | `read_note`                                                      |
| Write note     | `obsidian_mcp_put_content`                                           | `write_note` (overwrite/append/prepend modes)                    |
| Patch note     | `obsidian_mcp_patch_content`                                         | `patch_note` (exact string match, safe multi-match protection)   |
| Delete note    | `obsidian_mcp_delete_file`                                           | `delete_note` (with `confirmPath` safety + trash modes)          |
| List files     | `obsidian_mcp_list_files_in_vault`, `obsidian_mcp_list_files_in_dir` | `list_directory` (dirs + files separated)                        |
| Search         | `obsidian_mcp_simple_search`, `obsidian_mcp_complex_search`          | `search_notes` (BM25 relevance, multi-word, content+frontmatter) |
| Batch read     | `obsidian_mcp_batch_get_file_contents`                               | `read_multiple_notes` (up to 10, ok/err structure)               |
| Frontmatter    | No dedicated tool (manual YAML parsing)                              | `update_frontmatter`, `get_frontmatter` (via gray-matter)        |
| Tags           | No dedicated tool                                                    | `manage_tags` (add/remove/list)                                  |
| Move/rename    | No dedicated tool (delete+write)                                     | `move_note`, `move_file` (binary-safe, with confirmation)        |
| Copy file      | `obsidian_mcp_copy_file`                                             | No equivalent                                                    |
| Metadata       | No dedicated tool                                                    | `get_notes_info` (size, modified, hasFrontmatter)                |
| Vault stats    | No dedicated tool                                                    | `get_vault_stats` (notes count, folders, size, recent files)     |
| List all tags  | No dedicated tool                                                    | `list_all_tags` (with occurrence counts)                         |
| Periodic notes | `obsidian_mcp_periodic_notes`, `obsidian_mcp_recent_periodic_notes`  | No equivalent                                                    |
| Recent changes | `obsidian_mcp_recent_changes`                                        | No equivalent                                                    |
| Web search     | `obsidian_mcp_web_search`                                            | No equivalent                                                    |
| Web fetch      | `obsidian_mcp_get_website_contents`                                  | No equivalent                                                    |

## Key Differences

### 1. Transport Model

- **obsidian-mcp**: HTTP server requires a persistent background process. Port 54321 must be running. Single point of failure.
- **MCPVault**: stdio transport — process spawned on-demand by MCP client. No port, no daemon, no network exposure.

### 2. Security Model

- **obsidian-mcp**: No documented path filtering. Server trusts the vault path entirely.
- **MCPVault**: Explicit PathFilter blocks `.obsidian/`, `.git/`, `node_modules/`, dot files. Path traversal prevention via `resolvePath()`. Confirmation required for delete/move.

### 3. Frontmatter Handling

- **obsidian-mcp**: No dedicated frontmatter tools. Skills manually parse YAML. Risk of YAML corruption on write.
- **MCPVault**: `gray-matter` library for safe YAML parsing/stringification. Dedicated `update_frontmatter` and `get_frontmatter` tools. Validates frontmatter structure (blocks functions, symbols).

### 4. Token Optimization

- **obsidian-mcp**: Full JSON responses with verbose field names.
- **MCPVault**: Minified field names by default (`fm` not `frontmatter`, `p` not `path`, `ex` not `excerpt`). Optional `prettyPrint: true`. Search returns compact objects with 21-char excerpts.

### 5. Write Modes

- **obsidian-mcp**: `put_content` overwrites entirely. `append_content` appends. No prepend.
- **MCPVault**: `write_note` supports `overwrite`, `append`, `prepend` with frontmatter merging. `patch_note` for surgical string replacement with safety against accidental multi-match replaces.

### 6. Search Quality

- **obsidian-mcp**: `simple_search` (basic text match), `complex_search` (structured query object). No relevance ranking documented.
- **MCPVault**: BM25 relevance reranking, multi-word matching, configurable content/frontmatter search scope, case sensitivity option. Returns Obsidian deep links (`obsidian://open?`).

### 7. Deletion Safety

- **obsidian-mcp**: `delete_file` — no confirmation, no trash.
- **MCPVault**: `delete_note` requires `confirmPath` match. Three trash modes: `none` (permanent), `local` (to `.trash`), `system` (OS trash).

### 8. Move/Rename

- **obsidian-mcp**: No dedicated move tool. Workaround: delete + write at new path. Breaks Git history.
- **MCPVault**: `move_note` (notes only), `move_file` (any file, binary-safe). Both require confirmation. Preserves Git history.

### What obsidian-mcp Has That MCPVault Doesn't

- `obsidian_mcp_periodic_notes` / `obsidian_mcp_recent_periodic_notes` — Obsidian daily/weekly note support
- `obsidian_mcp_recent_changes` — recently modified files
- `obsidian_mcp_copy_file` — copy within vault
- `obsidian_mcp_web_search` — sandboxed web search
- `obsidian_mcp_get_website_contents` — fetch external URLs

### What MCPVault Has That obsidian-mcp Doesn't

- 15 well-documented tools vs ~16 obsidian-mcp tools (but more focused on vault ops)
- Structured error handling (`ok`/`err` arrays for batch ops)
- Vault stats endpoint
- Tag management
- Frontmatter validation
- BM25 search
- Token-optimized output

## Impact on Existing Skills

### Skills that need tool name changes:

| Skill                         | Current tools                                                                                                                                            | New MCPVault tools                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `load-context`                | `obsidian_mcp_get_file_contents`, `obsidian_mcp_list_files_in_dir`                                                                                       | `read_note`, `list_directory`                                            |
| `add-daily-entry`             | `obsidian_mcp_get_file_contents`, `obsidian_mcp_put_content`                                                                                             | `read_note`, `write_note` (with append mode)                             |
| `archive-note`                | `obsidian_mcp_list_files_in_dir`, `obsidian_mcp_get_file_contents`, `obsidian_mcp_put_content`, `obsidian_mcp_delete_file`, `obsidian_mcp_patch_content` | `list_directory`, `read_note`, `write_note`, `delete_note`, `patch_note` |
| `note-decision`               | `obsidian_mcp_put_content`, `obsidian_mcp_patch_content`                                                                                                 | `write_note`, `patch_note`                                               |
| `search-notes`                | `obsidian_mcp_simple_search`                                                                                                                             | `search_notes`                                                           |
| `archive-note` (index update) | `obsidian_mcp_patch_content`                                                                                                                             | `patch_note`                                                             |

### Skills that gain capabilities:

| Skill             | New capability                                                 |
| ----------------- | -------------------------------------------------------------- |
| `note-decision`   | `update_frontmatter` for safer YAML updates                    |
| `archive-note`    | `move_note` instead of delete+write (preserves Git)            |
| `add-daily-entry` | `write_note` with `append` mode (no more full-file read/write) |

### Skills that lose capabilities:

| Skill          | Lost capability                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `load-context` | `obsidian_mcp_periodic_notes` — no direct periodic note support                                              |
| All skills     | `obsidian_mcp_web_search`, `obsidian_mcp_get_website_contents` — web search/fetch moves to pi's native tools |

## Migration Complexity

**Low effort**: `search-notes` — one tool name change, same pattern.

**Medium effort**: `load-context`, `add-daily-entry`, `note-decision` — tool name changes + slight parameter adjustments.

**Medium-high effort**: `archive-note` — move strategy changes (delete+write → delete+write or use `move_note`), delete confirmation required.

**No change needed**: Skills that don't use Obsidian (Jira, PR, deck skills, etc.)

**Skills to remove from MCP config**: `obsidian-mcp` server entry entirely replaced by MCPVault.
