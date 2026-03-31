# Architecture Decisions

This document records the main architectural decisions Roscoe is currently making on purpose. The goal is to explain not just what the code does, but why the system is shaped this way.

## 1. Roscoe is the supervisor, not the main executor

Decision:

- Guild does the long-running execution work.
- Roscoe reads the lane, decides the next move, and manages approval/governance.

Why:

- It keeps execution context inside the provider-native worker session.
- It lets Roscoe act as a consistent control layer across Claude and Codex.
- It makes approval, confidence scoring, and operator intervention explicit.

Tradeoff:

- There are two LLM loops to reason about instead of one.
- The transcript and UI must merge them into one coherent conversation.

## 2. Guild and Roscoe runtimes are configured separately

Decision:

- The project can pin Guild to one provider/runtime and Roscoe to another.

Why:

- Execution and supervision benefit from different tradeoffs.
- A repo may prefer Claude for deep code execution but Codex for Roscoe drafting, or the inverse.
- This avoids forcing a single-provider architecture across the entire product.

Tradeoff:

- Runtime state and TUI status need to distinguish saved project defaults from live lane runtime identity.

## 3. Runtime/governance setup is one shared wizard

Decision:

- Onboarding and the live `u` panel use the same runtime/governance component and persist the same settings.

Why:

- The operator should not learn two different control systems for the same dials.
- A project's saved defaults need one source of truth.
- It reduces drift between initial setup and later edits.

Tradeoff:

- The shared wizard must serve both a first-run flow and a mid-session editing flow without becoming confusing.

## 4. Project intent is a runtime dependency, not passive documentation

Decision:

- Onboarding saves a structured project brief and Roscoe reuses it continuously.

Why:

- Roscoe cannot make coherent confidence decisions from transcript text alone.
- Product story, validation rules, hardening posture, and architecture principles need to influence live execution and reply drafting.
- This prevents every lane from rediscovering the same project rules from scratch.

Tradeoff:

- Onboarding is intentionally heavier than a simple project name prompt.

## 5. Architecture principles are explicitly captured during onboarding

Decision:

- Roscoe must save architecture principles even when the repo does not currently force a major architecture fork.

Why:

- Good architecture guidance is not limited to one big decision.
- Shared components, DRY seams, queue boundaries, audit logging, ownership, and idempotent write paths are all operating rules that matter before the first large refactor.
- This keeps future Guild work from drifting into ad hoc duplication or invisible coupling.

Tradeoff:

- The onboarding interview has to push beyond product goals and into system design expectations.

## 6. Verification is progressive, not universally exhaustive up front

Decision:

- Roscoe defaults to risk-based validation and progressive hardening instead of insisting on blanket 100% coverage before the shape of the work is proven.

Why:

- Early product work is often exploratory, and exhaustive test hardening too soon can become the bottleneck instead of the safety net.
- Narrow proof on the changed slice is usually enough to keep iteration honest while the operator is still deciding whether the feature shape is right.
- Broader coverage and stricter gates still matter, but they should grow with feature stability, user acceptance, and risk.

Tradeoff:

- Roscoe needs stronger judgment about when to keep moving, when to request a preview, and when to push for broader hardening before calling a slice done.

## 7. Deployment is part of the saved project contract

Decision:

- Roscoe captures deployment as part of onboarding and refinement, even if the result is "defer for now".

Why:

- Existing repos already have release patterns Roscoe should preserve instead of replacing.
- Greenfield repos still need an explicit deployment stance because deploy shape changes architecture, secrets, and validation.
- There is no safe generic `deploy` command without project-specific understanding.

Tradeoff:

- The brief schema and prompts have to carry one more operational dimension, and Roscoe has to infer responsibly instead of overcommitting.

## 8. The transcript is semantic, not raw-stream-first

Decision:

- Roscoe stores normalized transcript events instead of treating provider output text as the only truth.

Why:

- Claude and Codex stream differently.
- The operator needs one conversation view that includes Guild turns, Roscoe drafts, user sends, tool activity, and errors.
- Persisted lanes must restore cleanly across app restarts.

Tradeoff:

- Roscoe has to maintain a translation layer from provider stream events into transcript entries.

## 9. Transcript ordering is based on event time

Decision:

- Restored transcript entries are sorted by timestamp, with stable tie-breaking, before rendering and restore inference.

Why:

- Persisted append order is not always the same as semantic conversation order.
- The operator expects the transcript to read like a conversation, not like an event-log race condition.

Tradeoff:

- Restore logic must infer waiting state and pending drafts from normalized transcript entries rather than from naive append order.

## 10. Live lanes stay alive outside transcript view

Decision:

- Session wiring lives at the app shell, not only inside the session transcript screen.

Why:

- The operator often opens onboarding, runtime controls, or setup while existing lanes continue running.
- A lane should not stall just because the user changed screens.

Tradeoff:

- The TUI needs additional background activity cues so the operator still knows active lanes are moving.

## 11. The `Command Deck` is the control point for Roscoe replies

Decision:

- Roscoe reply handling is centralized in a dedicated control surface instead of being buried in transcript bubbles.

Why:

- Approve, edit, hold, manual override, and auto-send are operational actions, not just messages.
- Confidence and reasoning belong next to the action affordances.

Tradeoff:

- Some e2e tests and older assumptions drift whenever this surface evolves, so tests need to key off stable behavior instead of stale labels.

## 12. Token efficiency primarily downshifts Roscoe, not Guild

Decision:

- `save-tokens` mainly biases Roscoe's drafting runtime to stay lighter until the transcript proves more depth is needed.

Why:

- Roscoe is a frequent supervisory loop, so small savings matter there.
- Guild is the execution engine, where under-spending reasoning too aggressively is more expensive.

Tradeoff:

- The TUI needs to surface token-efficiency mode clearly so operators understand that Roscoe may be intentionally lighter than Guild.

## 13. Guild may use native delegation when the runtime supports it

Decision:

- Roscoe may steer Guild to use provider-native agent or sub-agent delegation for bounded parallel subtasks.

Why:

- Claude Code, Codex, and similar runtimes can sometimes search, test, and implement faster by splitting independent work.
- Roscoe already supervises multiple lanes, so bounded intra-lane delegation is a natural extension when it shortens the loop without losing clarity.

Tradeoff:

- Roscoe must keep ownership, summaries, and transcript rendering clear so delegation does not turn the lane into unreadable hidden work.

## 14. Background compatibility with `.llm-responder` is maintained

Decision:

- Roscoe reads legacy `.llm-responder` state and migrates it into `.roscoe`.

Why:

- Existing projects and historical context should not be lost during the rename to Roscoe.
- The migration burden belongs in the product, not on every operator.

Tradeoff:

- Persistence code is more complex because it has to normalize both legacy and canonical storage.

## 15. The top header is a mixed live-plus-saved status surface

Decision:

- The top header combines live lane runtime identity with saved project governance defaults.

Why:

- Operators need to know both what this lane is using right now and what the project is configured to prefer overall.
- Reopening `u` for every check is too expensive during active work.

Tradeoff:

- The header must stay compact and intuitive, so only the most operationally important dials belong there.

## What should stay true as the codebase evolves

- Do not collapse Guild execution and Roscoe supervision back into one undifferentiated chat loop.
- Do not let onboarding and runtime editing drift into separate configuration systems.
- Do not treat architecture principles as optional prose that never reaches live prompts.
- Do not treat deployment as an ad hoc late-lane command with no saved project contract.
- Do not regress transcript rendering back to append-order event dumps.
- Do not move background lane progress behind the currently focused screen.
