# LLM Variance Testing Script

**Created**: 2026-03-19
**Status**: in-progress

## Context
Created `local_eval/run_insights_completion_variance.py` in `ai_observability` project to measure LLM output variance by running the same completion N times on a single input.

## Implementation
- Based on `run_insights_completion.py`
- `N_RUNS = 5` constant controls repetitions
- Runs completions concurrently with semaphore
- Each output record includes `run_index` and `total_runs` metadata
- Output dataset: "Foundation Insights Agent Dataset Variance"

## Branch
`AI-local-eval-testing`
