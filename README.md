# orch (v0.1, P0 slice)

Local-first layer under AI coding agents (Codex, Hermes Agent, any MCP client): compiles vague prompts into specs or questions, injects only relevant skills, verifies output, checkpoints before work, and records a redacted local history.

## Quick start
```
npm install && npm test        # 18 tests
npm run build
node dist/src/cli.js init --root /path/to/your/project   # add --dry-run to preview
node dist/src/cli.js doctor --root /path/to/your/project
```
Requires Node 22.5+ (uses the built-in, experimental `node:sqlite`).

## What `init` does (idempotent, never overwrites your content)
- Indexes the project into `.orch/` and adds `.orch/` to `.gitignore`.
- Writes a fenced rules block into `AGENTS.md` and copies skills to `.agents/skills/`.
- Codex: `.codex/config.toml` (MCP server) and `.codex/hooks.json`.
- Hermes (if detected): merges an MCP entry and the skills directory into `~/.hermes/config.yaml` (override with `--hermes-home`).

## Automatic context injection (Codex hooks)
On each task-like prompt, the `UserPromptSubmit` hook returns Codex's `additionalContext` with: the compiled spec and acceptance checks, edge cases to cover, the 1 to 3 matching skills, and approved project rules, capped at about 2,000 tokens. Vague prompts get "ask the user these questions first" instead. Questions, chat and slash commands are left alone. If anything fails, the hook adds nothing and never blocks the prompt.

## Edge-case checklist
`compile_task` lists up to 6 edge cases that fit the task (empty or invalid input, unauthorized users, network failure, empty results, duplicate submits, accessibility). `verify_changes` checks whether the changed test files mention each one. This is a keyword heuristic, not proof of coverage; gaps are reported as a medium finding and do not fail the run.

## MCP tools
`get_project_context`, `compile_task`, `start_task`, `select_skills`, `request_confirmation`, `verify_changes`, `explain_changes`, `search_memory`, `propose_memory`, `record_event`, `rollback_task`.

## Known limits (be aware)
- Not yet tested against a live Codex or Hermes install. The hook output format matches Codex's documented `hookSpecificOutput.additionalContext`, but needs a real-world check. Enable the hooks flag under `[features]` in your Codex config (`codex_hooks = true` in recent docs; the name varies by version). Codex loads project config only for trusted projects.
- Hermes has no hook injection yet; it relies on the agent calling the MCP tools.
- `request_confirmation` tells the agent to stop and ask; it cannot force the host agent to comply.
- The intent compiler is rule-based; checkpoints cover tracked files only.
- Not built yet: P1+ features, ChatGPT/API proxy mode, VS Code extension.
