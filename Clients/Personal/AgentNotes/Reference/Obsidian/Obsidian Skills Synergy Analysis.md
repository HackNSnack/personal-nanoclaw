 Current Architecture                                                                                                                                                 
                                                                                                                                                                      
 Vault structure:                                                                                                                                                     
                                                                                                                                                                      
 ```                                                                                                                                                                  
   Clients/                                                                                                                                                           
   ├── {Client}/AgentNotes/                                                                                                                                           
   │   ├── Active/          — work-in-progress notes                                                                                                                  
   │   ├── Archive/         — completed notes                                                                                                                         
   │   └── Reference/       — evergreen knowledge                                                                                                                     
   │   └── _Index.md        — per-client TOC                                                                                                                          
   ├── Daily Tracker/       — per-day task logs (client-agnostic)                                                                                                     
   └── (Weeklies/ exists in some clients)                                                                                                                             
 ```                                                                                                                                                                  
                                                                                                                                                                      
 8 skills: search-notes, load-context, add-daily-entry, archive-note, note-decision, new-client, weekly-report, review-pr                                             
                                                                                                                                                                      
 ────────────────────────────────────────────────────────────────────────────────                                                                                     
                                                                                                                                                                      
 Pros                                                                                                                                                                 
                                                                                                                                                                      
 1. Clear separation of concerns — Active/Archive/Reference maps to natural note lifecycle                                                                            
 2. _Index.md per client — single source of truth for what exists                                                                                                     
 3. search-notes is a good entry point — BM25 search covers most lookup needs                                                                                         
 4. load-context is smart — reads _Index.md + Active/ to give working memory                                                                                          
 5. weekly-report ties daily work to client output — closes the loop                                                                                                  
 6. review-pr is well-structured — loads standards, analyzes, confirms, posts. Solid workflow                                                                         
 7. Frontmatter consistency — type, status, tags on notes enables filtering                                                                                           
                                                                                                                                                                      
 Cons & Friction Points                                                                                                                                               
                                                                                                                                                                      
 ### 1. Client detection is fragile                                                                                                                                   
                                                                                                                                                                      
 Every skill says "determine client from working directory." This means:                                                                                              
 - Works only when you're in a project directory that maps to a client                                                                                                
 - Fails for cross-client queries — search-notes handles this, but load-context, archive-note, note-decision, new-client do not                                       
 - You said it yourself — you usually just tell the model where to go. That's the skill telling you it can't figure it out                                            
                                                                                                                                                                      
 The real problem: The skills have no fallback. They can't look at the vault structure to guess, and they don't ask "which client?" proactively — they just fail      
 silently or produce wrong paths.                                                                                                                                     
                                                                                                                                                                      
 ### 2. _Index.md is not kept in sync                                                                                                                                 
                                                                                                                                                                      
 Look at Ardoq's _Index.md — it has "Recently Archived" with orphaned entries (notes not under Clients/Ardoq/AgentNotes/Archive/). The archive-note skill is supposed 
 to update _Index.md, but:                                                                                                                                            
 - patch_note with --- separators breaks (documented in add-daily-entry too)                                                                                          
 - So skills fall back to write_note full overwrite — meaning they need to read the entire _Index.md first, then rewrite it                                           
 - This is a read-then-write cycle that adds complexity to every archiving operation                                                                                  
                                                                                                                                                                      
 ### 3. Reference/ is a dumping ground                                                                                                                                
                                                                                                                                                                      
 Ardoq's Reference/ has files both in structured subdirs (Development/, Infrastructure/) AND loose at the top level (Python Service API Headers.md, Nested sub-agent  
 result propagation.md). The _Index.md tries to organize them but:                                                                                                    
 - There's no skill that enforces or validates this structure                                                                                                         
 - note-decision always puts new notes in Active/, never Reference/                                                                                                   
 - Reference notes are created manually or via write_note with no skill guiding the process                                                                           
                                                                                                                                                                      
 ### 4. No Reference/ creation skill                                                                                                                                  
                                                                                                                                                                      
 new-client creates Reference/ directory but doesn't populate it. There's no equivalent of note-decision for creating reference notes. If you want to document        
 something permanent, you have to manually write the file or use a generic write_note call.                                                                           
                                                                                                                                                                      
 ### 5. add-daily-entry is decoupled from everything else                                                                                                             
                                                                                                                                                                      
 - Daily Tracker lives outside Clients/ — it's a parallel structure                                                                                                   
 - weekly-report reads from it, but add-daily-entry doesn't link daily entries back to AgentNotes                                                                     
 - No skill connects "I worked on X in Active/" to "log it in Daily Tracker"                                                                                          
 - The daily tracker has its own path structure (Daily Tracker/2026/03-March/) that doesn't share the client hierarchy                                                
                                                                                                                                                                      
 ### 6. archive-note is over-engineered                                                                                                                               
                                                                                                                                                                      
 It does 6 steps: list files → confirm → read → update frontmatter → delete → write → patch index. That's:                                                            
 - 1 list_directory                                                                                                                                                   
 - 1 read_note                                                                                                                                                        
 - 1 update_frontmatter                                                                                                                                               
 - 1 delete_note                                                                                                                                                      
 - 1 write_note                                                                                                                                                       
 - 1 patch_note (or 1 read_note + 1 write_note if --- present)                                                                                                        
                                                                                                                                                                      
 Minimum: 6-7 tool calls per archive. Meanwhile, move_note in MCPVault could do the move in 1 call. The skill doesn't use it.                                         
                                                                                                                                                                      
 ### 7. No skill for merging/cleaning up _Index.md                                                                                                                    
                                                                                                                                                                      
 As notes accumulate, _Index.md gets stale. No scheduled or triggered cleanup. You'd need a clean-index skill that:                                                   
 - Lists Active/ and Archive/                                                                                                                                         
 - Compares against _Index.md                                                                                                                                         
 - Removes orphaned entries                                                                                                                                           
 - Adds missing entries                                                                                                                                               
                                                                                                                                                                      
 ### 8. load-context only loads one client                                                                                                                            
                                                                                                                                                                      
 It's designed for a single client context. If you're working across Netlight + Ardoq + Personal, you need to manually invoke it per client. No "load all contexts"   
 or "switch client" capability.                                                                                                                                       
                                                                                                                                                                      
 ### 9. search-notes doesn't filter by type/status                                                                                                                    
                                                                                                                                                                      
 It searches content but doesn't leverage frontmatter filtering. You can't easily say "show me all status: in-progress notes" — you'd need to search for that pattern 
 in text.                                                                                                                                                             
                                                                                                                                                                      
 ### 10. weekly-report path is hardcoded                                                                                                                              
                                                                                                                                                                      
 Clients/<Client>/Weeklies/ — not all clients have this folder. No fallback or creation logic.                                                                        
                                                                                                                                                                      
 ────────────────────────────────────────────────────────────────────────────────                                                                                     
                                                                                                                                                                      
 Synergy Gaps                                                                                                                                                         
                                                                                                                                                                      
 ┌───────────────────────────────────────┬─────────────────────────────────────────────────────────────────┐                                                          
 │ Gap                                   │ Impact                                                          │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ Daily Tracker ↔ AgentNotes not linked │ Work done on a note isn't logged in daily tracker automatically │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ No "link note" skill                  │ Can't associate a daily entry with an AgentNote                 │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ archive-note doesn't use move_note    │ 6+ tool calls instead of 1-2                                    │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ No Reference/ note skill              │ Can't create reference notes through the skill system           │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ _Index.md maintenance is manual       │ Indexes go stale, no validation                                 │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ load-context is single-client         │ No multi-client awareness                                       │                                                          
 ├───────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤                                                          
 │ search-notes ignores frontmatter      │ Can't filter by status, type, tags effectively                  │                                                          
 └───────────────────────────────────────┴─────────────────────────────────────────────────────────────────┘                                                          
                                                                                                                                                                      
 ────────────────────────────────────────────────────────────────────────────────                                                                                     
                                                                                                                                                                      
 Suggested Improvements                                                                                                                                               
                                                                                                                                                                      
 ### Phase 1: Fix the basics (high impact, low effort)                                                                                                                
                                                                                                                                                                      
 1. Add client_name parameter to all client-facing skills                                                                                                             
 Instead of "determine from working directory," accept an optional client parameter. If not provided, try working directory, then ask. This makes skills usable       
 outside project directories.                                                                                                                                         
                                                                                                                                                                      
 2. Replace archive-note with move_note                                                                                                                               
 Use mcpvault_move_note to move from Active/ → Archive/ in 1 call. Only use update_frontmatter for status change. Drop the patch_note/write_note index update — or    
 make it optional. Target: 3 tool calls instead of 6-7.                                                                                                               
                                                                                                                                                                      
 3. Add search_notes frontmatter filtering                                                                                                                            
 Update search-notes to use searchFrontmatter: true and add a filters parameter for status, type, tags. This enables queries like "show me all in-progress work       
 notes."                                                                                                                                                              
                                                                                                                                                                      
 ### Phase 2: Bridge the gaps                                                                                                                                         
                                                                                                                                                                      
 4. Create link-note skill                                                                                                                                            
 Associates a daily tracker entry with an AgentNote. Writes a [[link]] in the daily tracker. This connects the two parallel structures.                               
                                                                                                                                                                      
 5. Create reference-note skill                                                                                                                                       
 Like note-decision but for Reference/ notes. Prompts for title, type, content structure. Creates under Clients/<Client>/AgentNotes/Reference/.                       
                                                                                                                                                                      
 6. Add clean-index skill                                                                                                                                             
 Compares _Index.md against actual Active/ and Archive/ contents. Reports drift. Optionally fixes it.                                                                 
                                                                                                                                                                      
 ### Phase 3: Cross-client awareness                                                                                                                                  
                                                                                                                                                                      
 7. load-context → load-clients                                                                                                                                       
 List all clients, load their _Index.md files. Show a summary of all active work across clients. Let user drill into specific ones.                                   
                                                                                                                                                                      
 8. weekly-report with fallback                                                                                                                                       
 Create Weeklies/ folder if it doesn't exist. Use write_note with mode: "overwrite" to create the report.                                                             
                                                                                                                                                                      
 ### Phase 4: Automation                                                                                                                                              
                                                                                                                                                                      
 9. Auto-daily-entry on task completion                                                                                                                               
 After note-decision, archive-note, or solve-issue completes, automatically add a daily tracker entry. This eliminates the need for add-daily-entry as a manual step. 
                                                                                                                                                                      
 10. Frontmatter validation                                                                                                                                           
 Add a validate-notes skill that checks: all Active/ notes have status: in-progress, all Archive/ notes have status: done, all notes have valid frontmatter.          
                                                                                                                                                                      
 ────────────────────────────────────────────────────────────────────────────────                                                                                     
                                                                                                                                                                      
 Summary                                                                                                                                                              
                                                                                                                                                                      
 Your skills work well individually but have structural gaps in how they connect to each other. The biggest issue is client detection — skills assume they can figure 
 out the client from the working directory, which fails in practice. The second is that archive-note and _Index.md maintenance are unnecessarily complex.             
                                                                                                                                                                      
 The vault structure itself (Active/Archive/Reference) is solid. The problem is the skills don't enforce or maintain it consistently. Fix client detection, simplify  
 archiving, and add the missing link and reference skills, and the system becomes self-maintaining.