# Migration Plan: obsidian-mcp → MCPVault

## Current State

- **Server**: `obsidian-mcp` (Python, HTTP transport on `localhost:54321`)
- **Config**: `~/.pi/.mcp.json` → `http://localhost:54321/mcp`
- **Tools used by skills**:
  - `obsidian_mcp_get_file_contents` — read single file
  - `obsidian_mcp_put_content` — write/overwrite file
  - `obsidian_mcp_patch_content` — patch content
  - `obsidian_mcp_delete_file` — delete file
  - `obsidian_mcp_list_files_in_dir` — list directory
  - `obsidian_mcp_list_files_in_vault` — list vault root
  - `obsidian_mcp_simple_search` — simple search
  - `obsidian_mcp_complex_search` — complex search
  - `obsidian_mcp_batch_get_file_contents` — batch read
  - `obsidian_mcp_periodic_notes` — periodic notes
  - `obsidian_mcp_recent_changes` — recent changes
  - `obsidian_mcp_recent_periodic_notes` — recent periodic
  - `obsidian_mcp_copy_file` — copy file
  - `obsidian_mcp_append_content` — append content
  - `obsidian_mcp_web_search` — web search
  - `obsidian_mcp_get_website_contents` — fetch URL

- **17 skills** that reference obsidian-mcp tools (search-notes, load-context, add-daily-entry, archive-note, note-decision, etc.)

## Target State (MCPVault)

- **Server**: `@bitbonsai/mcpvault` (Node.js, stdio transport, `npx`)
- **Config**: `~/.pi/.mcp.json` → stdio command pointing to vault
- **15 tools**:
  - `read_note` — read single note with frontmatter
  - `write_note` — create/overwrite (overwrite, append, prepend modes)
  - `patch_note` — find-and-replace patch
  - `list_directory` — list files/folders
  - `delete_note` — delete (requires `confirmPath`)
  - `search_notes` — full-text + frontmatter search, BM25 reranking
  - `move_note` — move/rename notes
  - `move_file` — move any file (binary-safe, requires confirmations)
  - `read_multiple_notes` — batch read (max 10)
  - `update_frontmatter` — update YAML frontmatter only
  - `get_notes_info` — metadata without content
  - `get_frontmatter` — frontmatter only
  - `manage_tags` — add/remove/list tags
  - `get_vault_stats` — vault statistics
  - `list_all_tags` — all tags with counts

## Key Differences

| Aspect         | obsidian-mcp (current)             | MCPVault (target)                                                        |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Transport      | HTTP stdio                         | stdio (npx)                                                              |
| Paths          | Absolute file paths                | Relative to vault root                                                   |
| Write          | `put_content` (full rewrite)       | `write_note` (overwrite/append/prepend)                                  |
| Patch          | `patch_content` (find/replace)     | `patch_note` (exact string match, `replaceAll` flag)                     |
| Delete         | `delete_file`                      | `delete_note` (requires `confirmPath`)                                   |
| Frontmatter    | Parsed from file content           | Dedicated tools (`get_frontmatter`, `update_frontmatter`, `manage_tags`) |
| Search         | `simple_search` + `complex_search` | `search_notes` (BM25, minified output)                                   |
| Batch read     | `batch_get_file_contents`          | `read_multiple_notes` (max 10)                                           |
| Move           | `copy_file` only                   | `move_note` + `move_file`                                                |
| Extensions     | Any file type                      | `.md`, `.markdown`, `.txt`, `.base`, `.canvas`                           |
| Security       | HTTP endpoint                      | Path filter, traversal prevention, frontmatter validation                |
| Extra features | Periodic notes, web search         | Vault stats, tag management, file move                                   |

## Migration Steps

### Phase 1: Install & Configure MCPVault

1. **Install MCPVault**
   ```bash
   pnpm install -g @bitbonsai/mcpvault
   ```

2. **Stop current obsidian-mcp server**
   ```bash
   # Kill the Python HTTP server on port 54321
   fuser -k 54321/tcp
   ```

3. **Update `~/.pi/.mcp.json`**
   Replace the obsidian entry:
   ```json
   {
     "mcpServers": {
       "obsidian": {
         "command": "npx",
         "args": ["@bitbonsai/mcpvault@latest", "/path/to/your/obsidian/vault"]
       },
       "atlassian": {
         "type": "http",
         "url": "https://mcp.atlassian.com/v1/mcp"
       }
     }
   }
   ```

4. **Verify connection**
   - Check MCP tools are available (should see MCPVault's 15 tools)
   - Test: `list_directory` with empty path `""` to list vault root

### Phase 2: Skill-by-Skill Migration

#### 2.1 `search-notes` (simplest)

**Before:**
```markdown
Use `obsidian_mcp_simple_search` with user's query
```

**After:**
```markdown
Use `search_notes` with user's query.
- `query`: search string
- `limit`: 10
- `searchContent`: true
- `searchFrontmatter`: false
- `prettyPrint`: true

Results return minified fields (p, t, ex, mc, ln, uri). Use `prettyPrint: true` for readable output.
```

#### 2.2 `load-context`

**Before:**
```markdown
Use `obsidian_mcp_get_file_contents` for `_Index.md`
Use `obsidian_mcp_list_files_in_dir` for `Active/`
```

**After:**
```markdown
Use `read_note` for `_Index.md`
Use `list_directory` for `Active/`
```

#### 2.3 `add-daily-entry`

**Before:**
```markdown
Use `obsidian_mcp_get_file_contents` to read
Use `obsidian_mcp_put_content` to write
```

**After:**
```markdown
Use `read_note` to read current tracker
Use `write_note` with `mode: "overwrite"` to write updated content
```

#### 2.4 `archive-note`

**Before:**
```markdown
Use `obsidian_mcp_put_content`
Use `obsidian_mcp_delete_file`
Use `obsidian_mcp_patch_content`
```

**After:**
```markdown
Use `read_note` to read note
Use `update_frontmatter` to change `status: in-progress` → `status: done`
Use `delete_note` with `confirmPath` to delete from Active/
Use `write_note` with `mode: "overwrite"` to create in Archive/
Use `patch_note` to update `_Index.md` (or `write_note` if `---` separators present)
```

#### 2.5 `note-decision`

**Before:**
```markdown
Use `obsidian_mcp_put_content`
Use `obsidian_mcp_patch_content`
```

**After:**
```markdown
Use `write_note` with `mode: "overwrite"` to create note
Include `frontmatter` object in the call (title, tags, type, status)
Use `patch_note` to update `_Index.md`
```

#### 2.6 Skills using `obsidian_mcp_simple_search` or `obsidian_mcp_complex_search`

Replace with `search_notes`. Key mapping:
- `query` → `query`
- `context_length` → no direct equivalent (use `prettyPrint: true` for full content)
- Complex search objects → flattened into `search_notes` params

#### 2.7 Skills using `obsidian_mcp_batch_get_file_contents`

Replace with `read_multiple_notes`:
```markdown
Use `read_multiple_notes` with `paths: ["note1.md", "note2.md"]`
- `includeContent`: true
- `includeFrontmatter`: true
- `prettyPrint`: true
```

#### 2.8 Skills using `obsidian_mcp_append_content`

Replace with `write_note` with `mode: "append"`:
```markdown
Use `write_note` with `mode: "append"`
```

#### 2.9 Skills using `obsidian_mcp_periodic_notes`, `obsidian_mcp_recent_changes`, `obsidian_mcp_recent_periodic_notes`

**No direct MCPVault equivalent.** Options:
- Use `list_directory` + `read_note` for recent files
- Use `get_vault_stats` for vault-level stats
- Implement periodic note logic manually via `list_directory` + `read_note`
- Or keep obsidian-mcp server running alongside MCPVault for these features

#### 2.10 Skills using `obsidian_mcp_copy_file`

Replace with `move_file` (MCPVault doesn't have a copy function, only move):
```markdown
Use `move_file` — note: MCPVault only supports move, not copy.
For copy, read + write the content to a new path.
```

#### 2.11 Skills using `obsidian_mcp_web_search` / `obsidian_mcp_get_website_contents`

**No MCPVault equivalent.** These are external tools, not vault operations. Keep as-is or use pi's native `web_search` / `fetch_content` tools.

### Phase 3: Remove obsidian-mcp Server

1. **Verify all skills work** with MCPVault (test each skill)
2. **Remove obsidian-mcp from dependencies** if installed globally
3. **Update `~/.pi/.mcp.json`** — obsidian entry now points to MCPVault (already done in Phase 1)
4. **Kill obsidian-mcp process** (already done in Phase 1)

### Phase 4: Cleanup

1. Update any documentation referencing `obsidian_mcp_*` tool names
2. Remove `mcp-cache.json` obsidian entry (will be regenerated)
3. Test full workflow: load-context → work → add-daily-entry → archive-note → search

## Risk Matrix

| Risk | Mitigation |
|------|-----------|
| `confirmPath` required for delete | Skills must include `confirmPath` param matching `path` |
| Relative vs absolute paths | All MCPVault paths are relative to vault root — strip leading `/` |
| No `copy_file` in MCPVault | Use read + write for copy operations |
| No periodic notes tool | Use `list_directory` + `read_note` or keep obsidian-mcp for these |
| No web search in MCPVault | Use pi's native `web_search` / `fetch_content` |
| Frontmatter format differences | MCPVault uses `gray-matter` — verify YAML compatibility |
| Path filter blocks dot files | MCPVault blocks `.obsidian/`, `.git/`, dot files — adjust skill paths if needed |

## Rollback Plan

If MCPVault doesn't work:
1. Revert `~/.pi/.mcp.json` to HTTP obsidian-mcp config
2. Restart obsidian-mcp server on port 54321
3. Restore original skill files from git
4. No data loss — vault files unchanged

## Estimated Effort

- **Phase 1** (install + config): 30 min
- **Phase 2** (skill migration): 2-3 hours (17 skills)
- **Phase 3** (cleanup): 15 min
- **Phase 4** (testing): 1 hour

**Total: ~4-5 hours**
