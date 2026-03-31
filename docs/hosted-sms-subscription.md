# Hosted SMS Subscription

Roscoe's current SMS wire works as a local remote-control channel for a live Roscoe process. A shared hosted SMS relay is the next step if CLI users should be able to subscribe and use Roscoe's global Twilio number without bringing their own Twilio account.

## Current State

- Roscoe already has a working two-way SMS control model for `status`, `approve`, `hold`, `resume`, and freeform lane guidance.
- Twilio is configured for a shared Roscoe number and the inbound phone-number webhook can point at Roscoe's public SMS endpoint.
- The K12.io app already has a mature Stripe stack:
  - hosted Checkout support
  - subscription webhooks
  - billing portal support
  - public webhook route at `/api/stripe/webhook`

## What Already Works

Today, a single operator can:

- arm SMS in Roscoe
- receive lane updates
- reply by text
- have Roscoe route that SMS back into the live lane system

What does not exist yet is a hosted subscriber model that lets arbitrary Roscoe CLI users pay for access to the shared relay and bind their own phone number to that service.

## Why The Existing K12 Stripe Flow Is Not Enough Yet

K12's current Stripe subscription webhook logic expects marketplace-style metadata such as:

- `user_id`
- `app_id`

That makes sense for app purchases, but not for a Roscoe relay subscription. A Roscoe subscriber is not buying a marketplace app. They are buying access to a hosted communications service.

So a Roscoe subscription cannot safely reuse the existing webhook handler unchanged.

## Recommended Architecture

### 1. Dedicated Roscoe Subscriber Model

Add a dedicated subscriber record in the hosted app, for example:

- `RoscoeSubscriber`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `phoneNumber`
- `phoneVerified`
- `smsConsentAt`
- `status`
- `createdAt`
- `updatedAt`

Optional but useful:

- `lastInboundAt`
- `lastOutboundAt`
- `defaultLaneScope`
- `notes`

### 2. Dedicated Roscoe Checkout Flow

Create a hosted server-side checkout path specifically for Roscoe SMS relay subscriptions.

It should:

- create or reuse a Stripe customer
- create a Stripe Checkout Session for the Roscoe monthly plan
- attach Roscoe-specific metadata like:
  - `product_line=roscoe_sms`
  - `subscriber_email`
  - `phone_number`
  - `consent_version`

Avoid depending on marketplace `app_id` / `user_id` semantics here.

### 3. Dedicated Roscoe Webhook Branch

Extend the hosted Stripe webhook handler so it detects Roscoe subscription metadata and routes those events into Roscoe subscriber provisioning logic instead of marketplace purchase logic.

That branch should:

- activate the subscriber on successful subscription creation/update
- suspend access on cancellation or failed-payment terminal states
- avoid writing into marketplace app/license tables

### 4. Hosted Phone Binding

Subscription alone is not enough. The hosted system should explicitly bind a subscriber's phone number.

Suggested flow:

1. User purchases or opens the hosted subscription flow.
2. User enters phone number and confirms SMS consent.
3. Hosted service sends a short verification code through the shared Twilio number.
4. User confirms the code.
5. Hosted subscriber record becomes active.

This keeps the shared Twilio relay tied to a verified phone number, not just a paid email address.

### 5. CLI Linking

The Roscoe CLI should eventually support a lightweight hosted-relay link step:

- paste a subscriber token or open a browser link
- confirm the phone number
- optionally choose which lanes can send SMS

That lets CLI users use the shared hosted relay without handling their own Twilio setup.

## Operational Rules

The hosted relay should enforce:

- active paid subscription
- verified phone number
- explicit SMS consent
- STOP/HELP handling
- rate limiting
- per-subscriber audit trail

It should also keep a clean distinction between:

- system alerts
- low-confidence review requests
- ad hoc user check-ins

## Good First Slice

The smallest credible hosted slice is:

1. One Stripe product and monthly recurring price for `Roscoe SMS Wire`
2. One hosted Checkout Session creator
3. One Roscoe-specific subscription webhook branch
4. One subscriber table
5. One phone verification step
6. One CLI/account link flow

That is enough to let real users subscribe and use the shared Twilio integration without managing Twilio themselves.

## Not In Scope Yet

- carrier-grade queueing
- multi-number pools
- separate SMS AI model orchestration
- fully autonomous hosted Roscoe that runs without any TUI process

Those can come later. The immediate goal is to make the shared Twilio relay safely usable by paid Roscoe users.
