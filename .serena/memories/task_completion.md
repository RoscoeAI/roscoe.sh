# Task completion checklist
- Run `npm test` after code changes; this is the primary project verification step.
- Run `npm run build` when changes affect TypeScript types, CLI entrypoints, or module wiring.
- Prefer targeted test files during iteration, then run the full suite before handoff.
- If changing CLI/TUI flows, also do a quick manual smoke check via `npm start` or the relevant `npm start -- <command>` entrypoint when feasible.
- If touching worktree logic, remember this code assumes git worktrees and may behave differently in non-git directories.
- Since there is no lint/format script, keep edits consistent with surrounding code style and avoid unnecessary rewrites.