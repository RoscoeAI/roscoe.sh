# AGENTS.md

This file bootstraps Codex-facing repo guidance for `roscoe`. The repo did not already contain an `AGENTS.md` at the time this was created.

## Project

Roscoe is a TypeScript ESM CLI/TUI for monitoring concurrent LLM coding sessions, reading transcript context, and suggesting the next response. It uses React with Ink for the terminal UI and Vitest for test coverage.

Roscoe's own onboarding flow writes `CLAUDE.md` in the project root. That is a Roscoe artifact, not a replacement for this `AGENTS.md`.

## Key Entry Points

- `src/index.ts`: CLI entrypoint and commands such as `start`, `onboard`, `projects`, and `worktrees`.
- `src/app.tsx`: top-level Ink app, reducer, screen routing, and session timeline state.
- `src/services/session-manager.ts`: session lifecycle, transcript restore, suggestion execution, and runtime updates.
- `src/response-generator.ts`: sidecar prompt assembly, transcript harvesting, and responder runtime selection.
- `src/config.ts`: profiles, project registry, settings, and project memory storage under `.roscoe` with legacy `.llm-responder` fallback.
- `src/onboarder.ts`: project onboarding and intent-brief generation.
- `sidecar-prompt.md`: system prompt used for Roscoe's response generation.

## Commands

- `npm run build`: compile TypeScript to `dist/`.
- `npm run lint`: run ESLint on `src`.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run test:coverage`: run tests with coverage.
- `npm run start`: launch the CLI via `tsx src/index.ts`.
- `npm run dev`: start Roscoe against the default `claude-code` profile.
- `npm run profiles`: list profiles.

## Working Notes

- The repo currently has no checked-in `README.md`, no project-local `.roscoe`, and no checked-in `CLAUDE.md`.
- Project memory is expected under `.roscoe/`, but the code still supports legacy `.llm-responder/` storage and migration.
- Tests live alongside source files in `src/` and include unit, component, and e2e-style coverage.
- Prefer reading existing tests before changing behavior because many UI and runtime expectations are already encoded there.
- The working tree may contain in-progress user edits. Do not revert unrelated changes.

## Change Guidance

- Keep changes aligned with the current TypeScript + Ink architecture instead of introducing parallel abstractions.
- When changing session flow, review `src/services/session-manager.ts`, `src/session-monitor.ts`, `src/conversation-tracker.ts`, and `src/response-generator.ts` together.
- When changing onboarding or saved project state, review both `src/config.ts` and its tests because storage includes legacy compatibility behavior.
- When changing CLI flags or runtime selection, update tests around `src/index.ts`, `src/llm-runtime.ts`, and `src/runtime-defaults.ts`.
