# Decision: Pydantic AI over Langchain

## Context
Evaluation of Python AI frameworks for building agent-based systems at Ardoq.

## Decision
**Choose Pydantic AI as the primary framework for AI agent development.**

## Problem Solved
Need for a production-ready, type-safe framework to build reliable AI agents with structured outputs and strong validation guarantees.

## Applicability
- New AI agent projects
- Services requiring structured LLM outputs
- Systems where type safety and validation are critical
- Standard agent workflows without extreme orchestration complexity

## When to Use Langchain Instead
- Complex multi-agent orchestration requirements
- Heavy RAG requirements with existing Langchain integrations
- Team already deeply invested in Langchain ecosystem
- Need for visual workflow design tools
