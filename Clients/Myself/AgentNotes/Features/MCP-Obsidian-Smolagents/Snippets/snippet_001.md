# Snippet 001: Smolagents Research

**Date:** 2025-12-18

## What is Smolagents?

Smolagents is HuggingFace's framework for building AI agents that dynamically write and execute Python code to solve tasks.

### Key Components

**CodeAgent:**
- Specialized agent for code generation and execution
- Generates Python code on-the-fly based on task requirements
- Executes code in controlled environments

### Security Features

**Custom LocalPythonInterpreter:**
- Not vanilla Python - rebuilt from ground up for security
- Blocks dangerous operations (e.g., dunder method calls)
- Sandboxed execution environment

**Docker Isolation:**
- Optional E2B integration for maximum isolation
- Resource constraints (CPU, memory, PIDs)
- Dropped capabilities for security

**Security Model:**
- Blocks dangerous operations
- No new privileges
- All capabilities dropped (`cap_drop=["ALL"]`)
- Runs as unprivileged user

### Basic Usage Pattern

```python
from smolagents import CodeAgent, DuckDuckGoSearchTool, HfApiModel

agent = CodeAgent(
    tools=[DuckDuckGoSearchTool()], 
    model=HfApiModel(),
    executor_type="docker"  # For Docker isolation
)
result = agent.run("Your query")
```

### References
- Official Docs: https://smolagents.org/docs/secure-code-execution-of-smolagents/
- HuggingFace Docs: https://huggingface.co/docs/smolagents/tutorials/secure_code_execution
- GitHub: https://github.com/huggingface/smolagents
