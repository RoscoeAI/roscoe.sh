# Onboarding Interview

Roscoe onboarding is not just a repo scan. It is the project contract Roscoe will keep using when Guild lanes execute and when Roscoe drafts replies later.

## What onboarding must establish

- Product story and primary users
- Definition of done and proof of completion
- Delivery pillars across frontend, backend, unit or component tests, and e2e tests
- For greenfield UI products, the initial entry surface: what the default route, homepage, landing page, dashboard, redirect, or embed-only first screen should be on first boot
- For greenfield UI products, the first local operator path: what should work on localhost, what seeds/auth/prerequisites are required, and which missing prerequisites must be surfaced explicitly as blockers
- Validation path for the repo, such as canonical tests, coverage reports, preview checkpoints, or manual validation
- Deployment contract, either inferred from the existing repo, chosen for a greenfield repo, or explicitly deferred
- For web-facing products, the first truthful hosted proof path: what preview, stage, or production URL should exist, how it stays updated, and what hosted presence counts as proof while the product evolves
- Non-goals, constraints, autonomy rules, quality bar, and risk boundaries
- Architecture principles that should keep future implementation coherent

## Validation philosophy

Onboarding should not hard-code a universal `100% coverage before progress` rule.

Roscoe should instead capture a staged validation philosophy:

- Early slices should use narrow, honest proof for the changed behavior
- Coverage and hardening should broaden as the feature stabilizes or risk rises
- Preview checkpoints are optional and should only be used when a live artifact will answer the next decision faster than more implementation
- The final brief should still name the repo's canonical validation path so Roscoe can tell the difference between iteration, handoff readiness, and real completion

## Architecture principles

Architecture is not limited to major redesign decisions. The onboarding interview should also lock in the standing rules Roscoe should keep defending as the codebase grows.

Examples of the kinds of principles Roscoe should capture:

- Reuse shared components and shared domain modules instead of duplicating feature logic
- Keep queueing, background jobs, and async side effects behind explicit seams
- Use unified audit logging and observability for material writes and workflow transitions
- Preserve clear ownership boundaries between UI, domain logic, and integrations
- Prefer explicit contracts and idempotent write paths for cross-system behavior

If the repo does not yet force a hard architecture choice, Roscoe should still save a repo-grounded default architecture stance in the brief so future lanes do not have to rediscover it from scratch.

## Greenfield UI guardrail

For greenfield apps with user-facing surfaces, onboarding should not stop at "builder exists" or "UI will be embeddable."

Roscoe should explicitly settle the first thing the developer expects to see when the app boots:

- a real homepage
- a landing page
- a dashboard
- an auth entry point
- a redirect to the main builder flow
- an embed-only surface with no standalone home

If that answer is not explicit, Roscoe should keep interviewing. Otherwise it is too easy for a scaffold placeholder to survive while the underlying subsystems improve.

Roscoe should also settle the first local-use truth for that UI:

- what route the developer should open on localhost
- whether seed data or a demo tenant is required
- whether sign-in is required before the route is meaningful
- whether external preview infrastructure is expected to be live yet
- what the app must say when those prerequisites are missing

If a local route only renders a shell plus messages like "tenant not found", "sign in", or "preview unavailable", Roscoe should not treat that as a meaningful completion state unless the saved brief explicitly says that shell-only behavior is the intended milestone.

If the repo has a hosting story, Roscoe should also settle the first non-local proof surface early:

- which preview, staging, or production environment should exist first
- what URL or URL pattern the operator should be able to open
- how that hosted surface stays updated as milestones land
- whether the hosted path is intentionally deferred, and why

## Where it persists

Saved interview understanding lives in `.roscoe/project.json` under `intentBrief`.

Architecture guidance is stored in:

- `intentBrief.architecturePrinciples`

Deployment guidance is stored in:

- `intentBrief.deploymentContract`

## Where it shows up

- Project Brief view
- Guild launch prompt
- Roscoe drafting context
- Any later refine flow when the operator reopens onboarding themes
