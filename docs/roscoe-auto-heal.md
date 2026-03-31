# Roscoe Auto-Heal

Roscoe's current auto-heal scope is intentionally narrow:

- It can reinterpret or repair stale saved metadata at startup.
- It can reopen a dead lane from saved history instead of blindly resuming a dead native provider session.
- It can route back to Dispatch instead of leaving the operator in a broken empty lane view.

This is controlled from the `Roscoe Settings` home tab as `Auto-heal metadata`.

What it does not do:

- It does not patch Roscoe's own source code.
- It does not hot-reload new behavior into the running TUI.
- It does not silently rewrite project code to recover from unrelated app bugs.

Current rationale:

- Metadata healing is low-risk and local to Roscoe's own persisted state.
- Source self-patching is a much larger trust, safety, and reload problem.
- Keeping those two categories separate makes recovery behavior legible and reversible.

## Future Research Note: Self-Patching / HMR

Potential future direction:

- Roscoe could eventually diagnose its own failure modes, draft a source patch, run tests, and ask the operator to approve the patch.
- A later step beyond that could explore a controlled hot-reload path for the Ink TUI so some fixes do not require a full restart.

Open problems before that is safe:

- How to distinguish a metadata issue from a real Roscoe source bug with high confidence.
- How to patch running code without corrupting in-memory session state.
- How to keep provider sessions, React/Ink state, and event bridges coherent across a reload.
- How to ensure Roscoe never self-mutates silently in ways the operator cannot audit.

For now, Roscoe only auto-heals metadata and restore state.
