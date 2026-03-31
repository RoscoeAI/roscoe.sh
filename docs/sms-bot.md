# SMS Bot

Roscoe's SMS wire is now a first-class lane control surface, not just a one-way alert channel.

## Current Behavior

When SMS is armed in Channel Setup:

- Roscoe texts milestone summaries.
- Roscoe texts intervention requests when a lane needs review, manual direction, or resume after a blocker.
- The operator can text back from the same phone number.

Current inbound SMS commands:

- `status`
  Returns the current lane summary and next-state hint.
- `approve`
  Sends the pending Roscoe draft to the Guild when a lane is waiting for review.
- `hold`
  Keeps the pending Roscoe draft unsent.
- `resume`
  Resumes a paused, blocked, or parked lane.
- freeform guidance
  Injects plain operator guidance into the lane or queues it for the next clean handoff.

When multiple lanes are live, prefix the text with a lane scope:

- `appsicle: status`
- `nanobots/auth: approve`
- `nanobots: resume`

## What This Is Not

The current SMS wire is not a fully independent Roscoe deployment.

- It does not run Roscoe logic by itself.
- It does not patch Roscoe source code.
- It relies on the live Roscoe TUI process for lane state, approval actions, and message injection.

If Roscoe is not running, Twilio can still receive the message, but no lane action will happen until the Roscoe process is alive to read and apply it.

## Why This Shape Works Now

This design keeps the operator contract simple:

- the TUI remains the source of truth for live lanes
- SMS becomes a remote control and alert wire
- approvals, holds, status checks, and resume commands use the exact same lane actions as the keyboard path

That avoids creating a second orchestration brain with slightly different behavior.

## Next Step: Hosted Roscoe Bot

If Roscoe grows into a real always-on phone bot, the next architecture step should be a dedicated hosted service in front of Twilio.

Recommended split:

1. Twilio inbound webhook receives SMS and validates signatures.
2. A Roscoe bot service resolves lane scope, applies lightweight commands (`status`, `approve`, `hold`, `resume`), and decides when a freeform SMS can be routed directly.
3. For ambiguous or higher-order replies, the bot service can use provider APIs directly instead of depending on the local CLIs.
4. The bot service writes durable conversation state so SMS control survives TUI restarts.
5. The TUI remains a rich operator console, not the only place where Roscoe can reason.

## Future Provider-API Layer

If the SMS bot needs deeper natural-language handling later, a provider-API layer can sit behind it:

- Anthropic or OpenAI for message classification and command disambiguation
- a policy layer that limits which lane actions can happen by SMS alone
- explicit approval records for auditability

That is intentionally future work. The current implementation keeps SMS deterministic and lane-safe.
