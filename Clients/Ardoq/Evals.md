

# What evaluations do we need:


1. Was the final output good compared to what we expected
2. Did the orchestrator call the right sub-agents
3. Did sub-agents call correct tools
4. Was the task completed?
5. Instruction Drift - were the LLMs deviating from the original user's intent?

# Strategies


## 1 - Final output eval

- G-eval
- Expected output vs. actual output


## 2 - correct call of sub-agents

- Cannot measure because we cannot programmatically access any tool calls, because sub-agents and downstream tool-calls are injected into the insight agent's system prompt


## 3 - Sub-agents correct tools


- Cannot measure because we cannot programmatically access any tool calls, because sub-agents and downstream tool-calls are injected into the insight agent's system prompt

## 4 - Task completion

- Cannot measure because we cannot programmatically access any tool calls, because sub-agents and downstream tool-calls are injected into the insight agent's system prompt

## 5 - Instruction Drift

- Cannot measure because we cannot programmatically access any tool calls, because sub-agents and downstream tool-calls are injected into the insight agent's system prompt


