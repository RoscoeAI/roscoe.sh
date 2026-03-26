# Roscoe Twilio Messaging Submission

Use these values for Roscoe's toll-free verification / messaging registration.

## Program basics

- Brand / service name: `Roscoe`
- Website: `https://roscoe.sh`
- Proof of consent URL: `https://roscoe.sh/sms-consent`
- Support email: `hello@roscoe.sh`
- Opt-in type: `Web Form`
- Estimated monthly volume: `100`

## Use case categories

- `Events`
- `2FA`
- `Account Notifications`

## Use case description

Roscoe sends transactional SMS related to account access and active work in progress. Messages include one-time verification codes, account status notifications, build-progress alerts, and direct developer question prompts when a human answer is required to continue an active Guild lane. Roscoe does not send marketing or promotional campaigns.

## Proof of consent

The public consent surface is the live opt-in form at:

- `https://roscoe.sh/sms-consent`

That page includes:

- an unchecked SMS consent checkbox
- the message categories
- message frequency disclosure
- `STOP` / `HELP` instructions
- `Msg & data rates may apply`
- carrier liability disclaimer
- links to the privacy policy and terms

## Sample messages

### 2FA

`Roscoe: your sign-in code is 482913. It expires in 10 minutes. Reply STOP to opt out, HELP for help. Msg & data rates may apply.`

### Account / build alert

`Roscoe: your Guild lane is 72% complete and waiting on your review. Reply STOP to opt out, HELP for help. Msg & data rates may apply.`

### Opt-in confirmation

`Roscoe: you’re subscribed to account notifications, verification codes, and work alerts. Reply STOP to opt out, HELP for help. Msg & data rates may apply.`

### HELP message

`Roscoe: help is available at hello@roscoe.sh. Reply STOP to opt out. Msg & data rates may apply.`

## Public policy URLs

- Privacy policy: `https://roscoe.sh/privacy`
- Terms & conditions: `https://roscoe.sh/terms`

## Privacy posture

Roscoe does not sell, share, rent, transfer, or exchange mobile opt-in data or SMS consent with third parties, affiliates, or partners for marketing or promotional purposes.
