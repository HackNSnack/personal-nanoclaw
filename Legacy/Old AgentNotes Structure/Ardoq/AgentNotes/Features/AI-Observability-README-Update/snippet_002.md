# README File Hierarchy and Orchestrator->Controller Updates

## Task Completed
1. Updated the file hierarchy visualization in README.md to reflect the actual current codebase structure
2. Replaced all occurrences of "orchestrator" with "controller" throughout the README

## File Hierarchy Changes Made

### Accurate Structure Visualization
- Added the complete `local_eval/` directory with all its actual files
- Updated `src/api/` structure to show `app.py` and `lifespan.py`
- Added specific middleware files (`host_whitelist.py`, `set_ardoq_context.py`)
- Listed all actual request and response model files
- Showed complete router structure with individual router files
- Updated `src/config/` to reflect actual files (`allowed_hosts.yml`, `config.yml`, `context.py`)
- Added all domain model files in `data/` and `eval/` directories
- Listed all controller implementations by name
- Showed all evaluator files with their actual names
- Included mappers, metrics, and repository files
- Added interface structure for evaluators and repositories
- Included `main.py` entry point
- Added missing files like `devenv.nix`

### Terminology Updates (Orchestrator → Controller)
- Updated data flow diagram: `EvaluationOrchestrator` → `EvaluationController`
- Changed file references: `eval_orchestrator.py` → `metric_eval_controller.py`
- Updated section headers: "Orchestrators" → "Controllers"
- Changed interface references: `IEvalOrchestrator` → `IEvalController`
- Updated dependency injection examples
- Changed factory function names and paths
- Updated pattern description: "Orchestration Pattern" → "Controller Pattern"
- Updated architectural decision explanations

## Current State
The README now shows:
- The exact file structure as it exists in the codebase
- Proper controller terminology throughout
- Accurate file paths and naming conventions
- Complete directory and file listings
- Correct architectural pattern descriptions

## Benefits
- Developers can now rely on the README for accurate navigation
- Documentation matches the refactored codebase architecture
- Clear understanding of the controller-based design pattern
- Proper reflection of the current implementation structure