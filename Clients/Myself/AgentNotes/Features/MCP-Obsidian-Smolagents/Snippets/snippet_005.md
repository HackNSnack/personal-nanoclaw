# Snippet 005: Docker Sandbox Implementation

**Date:** 2025-12-18

## DockerSandbox Class (src/web_search/sandbox.py)

**Current Status:** Implemented but **not actively used** in favor of smolagents' built-in Docker executor.

### Architecture

```python
class DockerSandbox:
    def __init__(self, image_tag: str = "agent-sandbox"):
        self.client: docker.DockerClient = docker.from_env()
        self.container = None
        self.image_tag = image_tag
```

### Container Creation

```python
def create_container(self):
    # Build Docker image
    self.client.images.build(path=".", tag=self.image_tag, rm=True, forcerm=True)
    
    # Create secure container
    container = self.client.containers.run(
        self.image_tag,
        command="tail -f /dev/null",  # Keep running
        detach=True,
        tty=True,
        mem_limit="512m",           # Memory limit
        cpu_quota=50000,            # CPU limit (50%)
        pids_limit=100,             # Process limit
        security_opt=["no-new-privileges"],
        cap_drop=["ALL"],           # Drop all capabilities
        network_mode="host",        # Internet access for searches
    )
```

**Security Constraints:**
- Memory: 512MB limit
- CPU: 50% quota (50000/100000)
- Processes: Max 100 PIDs
- Capabilities: All dropped
- Privileges: No new privileges allowed
- Network: Host mode (required for web access)

### Code Execution

```python
def run_code(self, code: str) -> Optional[str]:
    exec_result = container.exec_run(
        cmd=["python", "-c", code], 
        user="nobody"  # Unprivileged user
    )
    
    if exec_result.exit_code != 0:
        return f"Error in sandboxed execution: {output}"
    
    return output
```

**Key Points:**
- Executes as `nobody` user
- Captures stdout/stderr
- Returns execution errors

### Cleanup

```python
def cleanup(self):
    if self.container:
        self.container.stop()
        self.container.remove()
```

## Why Not Used?

Smolagents provides its own Docker executor (`executor_type="docker"`), which is used instead. This custom sandbox serves as:
1. Reference implementation
2. Potential fallback
3. Documentation of security requirements
