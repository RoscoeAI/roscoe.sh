# Roscoe Docs

Current internal docs:

- `architecture.md`
  Explains the current system shape: app shell, lane lifecycle, transcript model, runtime planning, persistence, onboarding, and UI control surfaces.
- `architecture-decisions.md`
  Records the main architectural decisions Roscoe is making on purpose, including the Guild/Roscoe split, the shared runtime wizard, semantic transcripts, background lanes, and token-efficiency scope.
- `runtime-governance.md`
  Maps the runtime/governance controls used by onboarding and the live `u` editor, including persistence, behavior, and TUI visibility.
- `onboarding-interview.md`
  Defines the codebase-grounded onboarding interview, including the architecture principles Roscoe must capture and reuse later.
- `roscoe-auto-heal.md`
  Explains the current metadata-only auto-heal setting and captures a light research note on future self-patching / TUI hot-reload ideas.
- `sms-bot.md`
  Describes the current two-way SMS control surface, lane-aware commands, and the future hosted Roscoe bot architecture.
- `hosted-sms-subscription.md`
  Captures the recommended subscription and provisioning architecture for letting CLI users pay to use Roscoe's shared hosted Twilio relay.
