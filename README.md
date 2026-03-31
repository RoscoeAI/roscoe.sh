# @roscoesh/cli

Roscoe is a terminal app for running and supervising long-lived AI work lanes.

Install it once, open Roscoe in any repo, onboard the project, and start lanes for Claude Code or Codex from one TUI.

Site and docs: [roscoe.sh](https://roscoe.sh)

## Install

```bash
npm install -g @roscoesh/cli
```

## Start Roscoe

```bash
roscoe
```

That opens the home TUI.

## Basic flow

1. `cd` into the repo you want to work on.
2. Run `roscoe`.
3. If the project is new, onboard it so Roscoe can learn the project story, definition of done, architecture rules, runtime defaults, and autonomy limits.
4. Start a lane and let Guild work while Roscoe supervises, drafts responses, and tracks progress.

## What You Need

- Node.js 20+
- Claude Code or Codex installed locally
- Access to whichever provider/runtime you want Roscoe to launch for Guild and Roscoe

## Common Commands

Open the TUI:

```bash
roscoe
```

Onboard the current repo directly from the CLI:

```bash
roscoe onboard .
```

See the command surface:

```bash
roscoe --help
```

## What Roscoe Does

- Runs a terminal UI for managing multiple lanes of work
- Keeps a saved project brief and onboarding contract per repo
- Lets Guild and Roscoe use different providers and runtimes
- Persists lanes so you can leave and resume work later
- Supports preview breaks, runtime controls, and lane-level supervision from the TUI

## Where To Learn More

- Product site and docs: [roscoe.sh](https://roscoe.sh)
- Package on npm: [@roscoesh/cli](https://www.npmjs.com/package/@roscoesh/cli)

## License

Apache License 2.0. See [LICENSE](./LICENSE).
