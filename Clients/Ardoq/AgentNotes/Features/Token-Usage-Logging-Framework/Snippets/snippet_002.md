# Framework Design Architecture

## Core Components Design

### Data Models (Pydantic-based)
```python
class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int  
    total_tokens: int
    model_name: str
    timestamp: datetime

class TokenEvent(BaseModel):
    usage: TokenUsage
    session_id: str
    metadata: dict[str, Any] = {}  # report_id, chat_id, etc.

class TokenStats(BaseModel):
    period_start: datetime
    period_end: datetime
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    event_count: int
    average_tokens_per_call: float
    metadata_group: dict[str, Any] = {}
```

### Key Classes
1. **TokenTracker**: Central aggregation and tracking engine
2. **TokenExtractor**: Extract usage from various LLM response formats  
3. **TokenLogger**: Main framework interface
4. **EnhancedLLMClient**: Wrapper with automatic tracking

## Integration Patterns Designed

### Pattern 1: Enhanced Client (Recommended)
```python
enhanced_client = EnhancedLLMClient(base_client)
result = await enhanced_client.run_completion(
    model, query, report_id="ABC123", chat_id="session_456"
)
```

### Pattern 2: Decorator
```python
@track_tokens(report_id="ABC123")
async def my_llm_function(query: str):
    return await llm_client.run_completion(model, query)
```

### Pattern 3: Context Manager
```python
async with token_tracking_context(chat_id="session_456"):
    result1 = await llm_client.run_completion("model1", query1)
    result2 = await llm_client.run_completion("model2", query2)
```

### Pattern 4: Manual Tracking
```python
logger.track_completion_result(result, model_name, session_id="abc", **metadata)
```

## Integration Strategy
- **Extend CompletionResult**: Add optional token usage field
- **Hook into LLMClient**: Modify base class for automatic detection
- **Leverage ardoqLogging**: Use existing structured JSON patterns
- **pydantic-ai Compatible**: Extract from pydantic-ai response objects