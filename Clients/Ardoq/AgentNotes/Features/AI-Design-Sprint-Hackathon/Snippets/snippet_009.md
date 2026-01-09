# Snippet 009 - Added CORS Support

## Issue
Browser blocked requests with "405 Method Not Allowed" on OPTIONS requests (CORS preflight)

## Fix
Added CORS middleware to `backend/src/main.py`:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Allows frontend running on Vite dev server (port 5173) or CRA (port 3000) to access backend.

## Note
Restart backend server for changes to take effect.
