# Snippet 003 - Tool Execution & Saveable Actions Requirements

## Requirements
- Extend chatbot to support tool calling (not just text completion)
- Track which tools the LLM executes during each interaction
- All tool executions are "saveable" (only pure text completion is not)
- Enable asking user: "Do you want me to store this functionality for you later?"
- Focus on single action saves (workflows come later)
- Tools should be simple and deterministic for demo purposes

## Key Points
- Text-only completion = NOT saveable
- Any processing/tool execution = SAVEABLE
- Backend must track tool calls
- Single action save for now
