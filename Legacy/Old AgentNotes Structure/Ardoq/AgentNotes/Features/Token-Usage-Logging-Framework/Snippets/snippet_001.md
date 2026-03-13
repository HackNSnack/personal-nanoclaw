# Token Usage Logging Framework - Initial Requirements

## Ticket Context
- **Goal**: Create logging framework for token consumption tracking
- **Problem**: Limited visibility into token usage beyond quota alerts
- **Location**: `ardoq_ai` package in devops-monorepo

## Core Requirements
1. **Token Metrics**:
   - Input tokens
   - Output tokens  
   - Total tokens
   
2. **Time-based Rates**:
   - Tokens per configurable time unit (seconds/minutes/hours)
   - Support for input, output, and total token rates
   
3. **Arbitrary Grouping**:
   - Group by metadata like report_id, chat_id
   - Flexible key-value metadata system
   
4. **Easy Integration**:
   - Add to existing functions/methods with minimal changes
   - Fit within current project structure

## Codebase Analysis Findings
- **Current Structure**: `ardoq_ai` is a library package consumed by other monorepo projects
- **Key Consumer**: `ai_observability` project uses LiteLLM for completions
- **Existing Patterns**: 
  - `CompletionResult` for LLM responses
  - `LLMClient` base class with pydantic-ai integration
  - `ardoqLogging` for structured JSON logging
  
## Architecture Philosophy
- **Minimal Overhead**: Easy adoption without major code changes  
- **Automatic Detection**: Hook into existing response objects when possible
- **Structured Logging**: Integrate with existing ardoqLogging patterns
- **Flexible Grouping**: Support arbitrary business logic metadata