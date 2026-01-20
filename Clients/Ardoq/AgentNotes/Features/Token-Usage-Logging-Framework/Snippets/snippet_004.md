# Framework Simplification

## Removed Complexities
Per user request, simplified the framework by removing:

1. **Auto-flushing and Background Tasks**:
   - Removed `auto_flush_interval`, `buffer_size` from config
   - Removed `flush_to_logs()`, `start_background_flush()`, `stop_background_flush()` methods
   - Removed threading locks and background task management
   - Removed structured logger integration from TokenTracker

2. **Batch Processing**:
   - Removed `batch_track_completions()` function
   - Removed `integration_helpers.py` file entirely
   - Simplified to individual event tracking only

3. **Global Tracking**:
   - Removed `setup_global_tracking()`, `get_global_token_logger()`, `init_global_token_logger()`
   - No global state management
   - Each TokenLogger instance is independent

4. **Excessive Docstrings**:
   - Removed all class-level and method-level docstrings
   - Kept only TODO comments for implementation guidance
   - Cleaner, more focused code structure

## Simplified Core Components

### TokenLoggingConfig
```python
class TokenLoggingConfig(BaseModel):
    enabled: bool = Field(default=True)
    default_time_window: timedelta = Field(default=timedelta(minutes=5))
```

### TokenTracker
```python
class TokenTracker:
    def __init__(self, config: TokenLoggingConfig) -> None:
        self.config = config
        self._events: list[TokenEvent] = []
        self._session_id = str(uuid.uuid4())
```

### TokenLogger
```python
class TokenLogger:
    def __init__(self, config: TokenLoggingConfig | None = None) -> None:
        self.config = config or TokenLoggingConfig()
        self.tracker = TokenTracker(self.config)
        self.extractor = TokenExtractor()
```

The framework is now much more focused and ready for step-by-step implementation without the complexity overhead.