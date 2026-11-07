---
name: context-engineering
description: Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure rules files and context for a project.
---

# Context Engineering

## Overview

Feed agents the right information at the right time. Context is the single biggest lever for agent output quality — too little and the agent hallucinates, too much and it loses focus. Context engineering is the practice of deliberately curating what the agent sees, when it sees it, and how it's structured.

## When to Use

- Starting a new coding session
- Agent output quality is declining (wrong patterns, hallucinated APIs, ignoring conventions)
- Switching between different parts of a codebase
- Setting up a new project for AI-assisted development
- The agent is not following project conventions

## The Context Hierarchy

Structure context from most persistent to most transient:

```
┌─────────────────────────────────────┐
│  1. Rules Files (CLAUDE.md, etc.)   │ ← Always loaded, project-wide
├─────────────────────────────────────┤
│  2. Spec / Architecture Docs        │ ← Loaded per feature/session
├─────────────────────────────────────┤
│  3. Relevant Source Files            │ ← Loaded per task
├─────────────────────────────────────┤
│  4. Error Output / Test Results      │ ← Loaded per iteration
├─────────────────────────────────────┤
│  5. Conversation History             │ ← Accumulates, compacts
└─────────────────────────────────────┘
```

### Level 1: Rules Files

Create a rules file that persists across sessions. This is the highest-leverage context you can provide.

**CLAUDE.md** (for Claude Code):
```markdown
# Project: [Name]

## Tech Stack
- React 18, TypeScript 5, Vite, Tailwind CSS 4
- Node.js 22, Express, PostgreSQL, Prisma

## Commands
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint -- --fix`
- Dev: `npm run dev`
- Type check: `npx tsc --noEmit`

## Code Conventions
- Functional components with hooks (no class components)
- Named exports (no default exports)
- colocate tests next to source: `Button.tsx` → `Button.test.tsx`
- Use `cn()` utility for conditional classNames
- Error boundaries at route level

## Boundaries
- Never commit .env files or secrets
- Never add dependencies without checking bundle size impact
- Ask before modifying database schema
- Always run tests before committing

## Patterns
[One short example of a well-written component in your style]
```

**Equivalent files for other tools:**
- `.cursorrules` or `.cursor/rules/*.md` (Cursor)
- `.windsurfrules` (Windsurf)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `AGENTS.md` (OpenAI Codex)

### Level 2: Specs and Architecture

Load the relevant spec section when starting a feature. Don't load the entire spec if only one section applies.

**Effective:** "Here's the authentication section of our spec: [auth spec content]"

**Wasteful:** "Here's our entire 5000-word spec: [full spec]" (when only working on auth)

### Level 3: Relevant Source Files

Before editing a file, read it. Before implementing a pattern, find an existing example in the codebase.

**Pre-task context loading:**
1. Read the file(s) you'll modify
2. Read related test files
3. Find one example of a similar pattern already in the codebase
4. Read any type definitions or interfaces involved

**Trust levels for loaded files:**
- **Trusted:** Source code, test files, type definitions auth