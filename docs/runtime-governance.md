# Runtime And Governance

This doc covers the controls that shape how Guild lanes run, how Roscoe drafts, and how those defaults appear in the TUI.

## Source Of Truth

Project defaults are persisted in `.roscoe/project.json` under `runtimeDefaults`.

Relevant keys:

- `guildProvider`
- `responderProvider`
- `workerByProtocol`
- `responderByProtocol`
- `workerGovernanceMode`
- `verificationCadence`
- `tokenEfficiencyMode`
- `responderApprovalMode`

`lockedProvider` still exists as a legacy compatibility field, but the effective Guild provider now comes from `guildProvider` when it is present.

## Onboarding vs `u`

Onboarding and the live `u` editor use the same runtime wizard and expose the same mental model:

- Guild provider
- Guild runtime mode
- Guild model
- Guild reasoning
- Execution mode
- Roscoe provider
- Roscoe model
- Roscoe reasoning
- Guild check-in mode
- Verification cadence
- Token efficiency
- Roscoe approval style

The shared `RuntimeEditorPanel` in `src/components/runtime-controls.tsx` is rendered both from onboarding and from the live `u` editor.

## Setting Map

### Guild provider

- Saved as `runtimeDefaults.guildProvider`
- Used to lock future Guild lane launches to a provider
- Filters launchable profiles in session setup
- Appears in Project Brief, onboarding/runtime summary pills, and session setup hints

### Guild runtime mode

- Saved as `runtimeDefaults.workerByProtocol[guildProvider].tuningMode`
- `auto` lets Roscoe retune Guild model/reasoning within the provider
- `manual` pins the Guild model/reasoning
- Appears as `Guild dynamic` or `Guild pinned`

### Guild model and Guild reasoning

- Saved as `runtimeDefaults.workerByProtocol[guildProvider].model` and `.reasoningEffort`
- Used when Guild launches and whenever runtime is manually pinned
- In auto mode they still define the saved baseline for that provider
- Appear in Project Brief, onboarding/runtime summary pills, and the top status header

### Execution mode

- Saved inside the worker and responder runtime entries as `executionMode`
- `safe` keeps provider-safe filesystem/network defaults
- `accelerated` uses broader access defaults for the chosen provider
- Appears in onboarding/runtime summary pills, Project Brief, session setup hints, and the top status header

### Roscoe provider

- Saved as `runtimeDefaults.responderProvider`
- Used to choose the provider Roscoe uses for drafts
- Appears in Project Brief, onboarding/runtime summary pills, session setup hints, and the top status header

### Roscoe model and Roscoe reasoning

- Saved as `runtimeDefaults.responderByProtocol[responderProvider].model` and `.reasoningEffort`
- Roscoe responder runtime is treated as pinned from the runtime editor
- Appear in Project Brief, onboarding/runtime summary pills, and the top status header

### Guild check-in mode

- Saved as `runtimeDefaults.workerGovernanceMode`
- Controls whether Guild operates as `Roscoe arbiter` or `Guild direct`
- Changes Guild startup instructions and Roscoe drafting instructions
- Appears in Project Brief, onboarding/runtime summary pills, and the top status header

### Verification cadence

- Saved as `runtimeDefaults.verificationCadence`
- Controls whether heavy repo-wide proof runs are batched or rerun for each focused slice
- Changes both Guild startup guidance and Roscoe drafting guidance
- Appears in Project Brief, onboarding/runtime summary pills, and the top status header

### Token efficiency

- Saved as `runtimeDefaults.tokenEfficiencyMode`
- Changes Roscoe runtime planning, not Guild provider selection
- `save-tokens` keeps Roscoe lighter by default until the transcript proves it needs more depth
- Appears in Project Brief, onboarding/runtime summary pills, session setup hints, and the top status header

### Roscoe approval style

- Saved as `runtimeDefaults.responderApprovalMode`
- Drives `AUTO` vs `MANUAL` response approval behavior
- Appears in Project Brief, onboarding/runtime summary pills, session setup hints, the top status header, and the bottom status bar

## Header Semantics

The top status header should answer two different questions without forcing the user to reopen `u`:

- What runtime is the active lane actually using right now?
- What project-level governance defaults are in force for this repo?

The current design uses:

- Live Guild runtime pill
- Live Roscoe runtime pill
- Saved Guild runtime mode pill
- Saved execution mode pill
- Saved governance pill
- Saved verification pill
- Saved token-efficiency pill
- Saved approval pill

This keeps the header aligned with the project defaults while still showing the live lane runtime identity.
