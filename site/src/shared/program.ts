export const consentVersion = "2026-03-25-v1";

export const consentCategories = [
  "Events",
  "2FA",
  "Account Notifications",
] as const;

export const monthlyVolume = 100;

export const supportEmailDefault = "hello@roscoe.sh";

export const sampleMessages = {
  twoFactor:
    "Roscoe: your sign-in code is 482913. It expires in 10 minutes. Reply STOP to opt out, HELP for help. Msg & data rates may apply.",
  progressAlert:
    "Roscoe: your Guild lane is 72% complete and waiting on your review. Reply STOP to opt out, HELP for help. Msg & data rates may apply.",
  optInConfirmation:
    "Roscoe: you’re subscribed to account notifications, verification codes, and work alerts. Reply STOP to opt out, HELP for help. Msg & data rates may apply.",
  help:
    "Roscoe: help is available at hello@roscoe.sh. Reply STOP to opt out. Msg & data rates may apply.",
};

export const consentDisclosure =
  "By entering your phone number and checking the consent box, you agree to receive SMS messages from Roscoe about account notifications, one-time verification codes, work-progress alerts, and developer action prompts. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out. Reply HELP for help. Carriers are not liable for delayed or undelivered messages.";

export const privacyDisclosure =
  "Roscoe does not sell, share, rent, transfer, or exchange mobile opt-in data or SMS consent with third parties, affiliates, or partners for marketing or promotional purposes.";

export const programDescription =
  "Roscoe sends transactional messages related to account access and active work in progress. Messages include one-time verification codes, Guild lane progress updates, account status notifications, and direct prompts when a developer response is required to continue work. Roscoe does not send marketing or promotional campaigns.";

export const frontierHighlights = [
  "Roscoe rides shotgun on Claude and Codex while Guild workers keep moving.",
  "Every wire home is tied to a real workflow: sign-in, account state, build progress, or a direct question.",
  "The consent surface is plainspoken on purpose: frontier in mood, compliance-first in operation.",
];
