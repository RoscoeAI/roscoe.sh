import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner, TextInput } from "@inkjs/ui";
import { useAppContext } from "../app.js";
import {
  ensureHostedRelayClientId,
  listRegisteredProjects,
  loadRoscoeSettings,
  saveRoscoeSettings,
  type RoscoeSettings,
} from "../config.js";
import { KeyHints, Panel, Pill } from "./chrome.js";
import { RoscoeIntro } from "./roscoe-intro.js";
import { cleanPhoneNumber, NotificationService } from "../notification-service.js";
import {
  discoverProvidersAsync,
  getProviderLabel,
  type DiscoveredProvider,
} from "../provider-registry.js";
import type { SessionState } from "../types.js";
import { setRoscoeKeepAwakeEnabled } from "../keep-awake.js";
import { openExternalUrl } from "../open-url.js";
import { dbg } from "../debug-log.js";
import { pollHostedRelayDeviceLink, startHostedRelayDeviceLink } from "../hosted-relay-client.js";

const HOME_TABS = [
  { label: "Dispatch Board", value: "dispatch" },
  { label: "Provider Setup", value: "providers" },
  { label: "Roscoe Settings", value: "roscoe" },
  { label: "Channel Setup", value: "channel" },
] as const;

type HomeTab = typeof HOME_TABS[number]["value"];
type FocusArea = "tabs" | "dispatch" | "provider-tabs" | "provider-actions" | "roscoe-actions" | "channel-actions";
type EditableChannelField = "phone" | null;

interface PendingConsentSnapshot {
  hostedTestVerifiedPhone: string;
  hostedRelayAccessToken: string;
  hostedRelayAccessTokenExpiresAt: string;
  hostedRelayRefreshToken: string;
  hostedRelayLinkedPhone: string;
  hostedRelayLinkedEmail: string;
}

interface HostedRelayPlan {
  priceId: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
  intervalCount: number;
  label: string;
}

interface HostedRelayStatus {
  phone: string;
  subscriptionStatus: string | null;
  active: boolean;
  recordUpdatedAt?: string;
  roundTripVerified?: boolean;
  roundTripVerifiedAt?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  linkedPhone?: string;
  userEmail?: string;
}

interface HostedRelaySmsStatus {
  ok: boolean;
  sid?: string;
  status?: string | null;
  delivered?: boolean;
  terminal?: boolean;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  error?: string;
  roundTripVerified?: boolean;
  roundTripVerifiedAt?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  phone?: string;
  linkedPhone?: string;
  userEmail?: string;
}

interface HostedRelayLinkSnapshot {
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  phone?: string;
  linkedPhone?: string;
  userEmail?: string;
}

interface HostedCheckoutSessionResult extends HostedRelayLinkSnapshot {
  url: string;
}

interface HomeInputKey {
  return?: boolean;
  escape?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

function describeHomeKey(input: string, key: HomeInputKey): string {
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.return || input === "\r" || input === "\n") return "enter";
  if (key.escape) return "escape";
  if (key.tab) return key.shift ? "shift+tab" : "tab";
  if (key.backspace) return "backspace";
  if (key.delete) return "delete";
  if (key.ctrl) return "ctrl";
  if (key.meta) return "meta";
  if (input) return "character";
  return "unknown";
}

function describeMcpServerCount(count: number): string {
  if (count === 0) return "0 MCP servers";
  if (count === 1) return "1 MCP server";
  return `${count} MCP servers`;
}

export function getRelayBaseUrl(): string {
  return process.env.ROSCOE_RELAY_BASE_URL?.trim() || "https://roscoe.sh";
}

export function formatPlanAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RoscoeActionKey = "auto-heal-metadata" | "park-at-milestones" | "prevent-sleep";

export function applyRoscoeAction(
  settings: RoscoeSettings,
  actionKey: RoscoeActionKey,
): {
  settings: RoscoeSettings;
  message: { text: string; color: "green" | "yellow" };
  keepAwakeEnabled?: boolean;
} {
  if (actionKey === "auto-heal-metadata") {
    const autoHealMetadata = !settings.behavior.autoHealMetadata;
    return {
      settings: {
        ...settings,
        behavior: {
          ...settings.behavior,
          autoHealMetadata,
        },
      },
      message: {
        text: autoHealMetadata
          ? "Roscoe will auto-heal stale lane metadata during startup restore."
          : "Roscoe metadata auto-heal is now off. Roscoe will stop rewriting stale saved lane state during startup.",
        color: autoHealMetadata ? "green" : "yellow",
      },
    };
  }

  if (actionKey === "prevent-sleep") {
    const preventSleepWhileRunning = !settings.behavior.preventSleepWhileRunning;
    return {
      settings: {
        ...settings,
        behavior: {
          ...settings.behavior,
          preventSleepWhileRunning,
        },
      },
      message: {
        text: preventSleepWhileRunning
          ? "Roscoe will keep this Mac awake while it is running."
          : "Roscoe will no longer request Mac keep-awake while it runs.",
        color: preventSleepWhileRunning ? "green" : "yellow",
      },
      keepAwakeEnabled: preventSleepWhileRunning,
    };
  }

  const parkAtMilestonesForReview = !settings.behavior.parkAtMilestonesForReview;
  return {
    settings: {
      ...settings,
      behavior: {
        ...settings.behavior,
        parkAtMilestonesForReview,
      },
    },
    message: {
      text: parkAtMilestonesForReview
        ? "Roscoe may now park lanes at major milestones and wait for human review before opening the next thread."
        : "Roscoe will keep planning the next slice instead of parking at milestone boundaries by default.",
      color: parkAtMilestonesForReview ? "yellow" : "green",
    },
  };
}

export function describeHostedSmsResult(phone: string, result: HostedRelaySmsStatus): { text: string; color: "green" | "red" | "yellow" } {
  if (!result.ok) {
    return {
      text: result.error || "Failed to send hosted test SMS.",
      color: "red",
    };
  }

  if (result.roundTripVerified) {
    return {
      text: `Hosted relay round trip verified for ${phone}. Reply C reached roscoe.sh and was delivered back into this CLI.`,
      color: "green",
    };
  }

  if (result.delivered) {
    return {
      text: `Hosted relay test SMS delivered to ${phone}. Reply C to verify the round trip back into this CLI.`,
      color: "yellow",
    };
  }

  if (result.terminal) {
    const status = result.status ? ` (${result.status})` : "";
    const detail = result.errorMessage ? ` ${result.errorMessage}` : "";
    return {
      text: `Hosted relay test SMS did not deliver${status}.${detail}`,
      color: "red",
    };
  }

  const status = result.status ?? "queued";
  const detail = result.errorMessage ? ` ${result.errorMessage}` : "";
  return {
    text: `Hosted relay test SMS submitted to Twilio for ${phone} (${status}). Reply C when it arrives to verify the round trip.${detail}`,
    color: "yellow",
  };
}

export async function pollHostedTestSmsStatus(relayBaseUrl: string, sid: string): Promise<HostedRelaySmsStatus> {
  let lastResult: HostedRelaySmsStatus = {
    ok: true,
    sid,
    status: "queued",
    delivered: false,
    terminal: false,
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await delay(2000);
    const response = await fetch(new URL(`/api/relay/sms/test-status?sid=${encodeURIComponent(sid)}`, relayBaseUrl));
    const payload = await response.json().catch(() => ({} as HostedRelaySmsStatus));
    if (!response.ok) {
      return {
        ok: false,
        error: payload.error || "Hosted relay SMS status is unavailable.",
      };
    }
    lastResult = payload;
    if (payload.delivered || payload.terminal) {
      return payload;
    }
  }

  return lastResult;
}

export async function requestHostedCheckoutSession(relayBaseUrl: string, phone: string, clientId: string): Promise<HostedCheckoutSessionResult> {
  const response = await fetch(new URL("/api/relay/billing/checkout-session", relayBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      clientId,
      successUrl: `${relayBaseUrl}/sms-consent?relay=success`,
      cancelUrl: `${relayBaseUrl}/sms-consent?relay=cancel`,
    }),
  });
  const payload = await response.json().catch(() => ({} as { error?: string; url?: string }));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || "Failed to create hosted relay checkout session.");
  }
  return {
    url: payload.url,
    accessToken: typeof (payload as HostedRelayLinkSnapshot).accessToken === "string" ? (payload as HostedRelayLinkSnapshot).accessToken : undefined,
    accessTokenExpiresAt: typeof (payload as HostedRelayLinkSnapshot).accessTokenExpiresAt === "string" ? (payload as HostedRelayLinkSnapshot).accessTokenExpiresAt : undefined,
    refreshToken: typeof (payload as HostedRelayLinkSnapshot).refreshToken === "string" ? (payload as HostedRelayLinkSnapshot).refreshToken : undefined,
    phone: typeof (payload as HostedRelayLinkSnapshot).phone === "string" ? (payload as HostedRelayLinkSnapshot).phone : undefined,
    linkedPhone: typeof (payload as HostedRelayLinkSnapshot).linkedPhone === "string" ? (payload as HostedRelayLinkSnapshot).linkedPhone : undefined,
    userEmail: typeof (payload as HostedRelayLinkSnapshot).userEmail === "string" ? (payload as HostedRelayLinkSnapshot).userEmail : undefined,
  };
}

let hasShownRoscoeIntro = false;

export function resetHomeScreenIntroForTests(): void {
  hasShownRoscoeIntro = false;
}

export function HomeScreen() {
  const { dispatch, state } = useAppContext();
  const notifier = useMemo(() => new NotificationService(), []);
  const projects = listRegisteredProjects();
  const [showIntro, setShowIntro] = useState(() => !hasShownRoscoeIntro);
  const [activeTab, setActiveTab] = useState<HomeTab>("dispatch");
  const [focusArea, setFocusArea] = useState<FocusArea>("dispatch");
  const [dispatchIndex, setDispatchIndex] = useState(0);
  const [providerTabIndex, setProviderTabIndex] = useState(0);
  const [providerActionIndex, setProviderActionIndex] = useState(0);
  const [discoveredProviders, setDiscoveredProviders] = useState<DiscoveredProvider[]>([]);
  const [providerDiscoveryStatus, setProviderDiscoveryStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [roscoeActionIndex, setRoscoeActionIndex] = useState(0);
  const [channelActionIndex, setChannelActionIndex] = useState(0);
  const [wireRevision, setWireRevision] = useState(0);
  const [editingChannelField, setEditingChannelField] = useState<EditableChannelField>(null);
  const [pendingConsentPhone, setPendingConsentPhone] = useState<string | null>(null);
  const [pendingConsentSnapshot, setPendingConsentSnapshot] = useState<PendingConsentSnapshot | null>(null);
  const [consentDialogIndex, setConsentDialogIndex] = useState(0);
  const [pendingDispatchTarget, setPendingDispatchTarget] = useState<"session-setup" | "onboarding" | null>(null);
  const [wireDraft, setWireDraft] = useState(() => loadRoscoeSettings().notifications.phoneNumber);
  const [wireMessage, setWireMessage] = useState<{ text: string; color: "green" | "red" | "yellow" } | null>(null);
  const [providerMessage, setProviderMessage] = useState<{ text: string; color: "green" | "red" | "yellow" } | null>(null);
  const [roscoeMessage, setRoscoeMessage] = useState<{ text: string; color: "green" | "red" | "yellow" } | null>(null);
  const [wireBusy, setWireBusy] = useState(false);
  const [hostedPlans, setHostedPlans] = useState<HostedRelayPlan[]>([]);
  const [hostedStatus, setHostedStatus] = useState<HostedRelayStatus | null>(null);
  const providerActionIndexRef = useRef(providerActionIndex);
  providerActionIndexRef.current = providerActionIndex;
  const roscoeActionIndexRef = useRef(roscoeActionIndex);
  roscoeActionIndexRef.current = roscoeActionIndex;
  const channelActionIndexRef = useRef(channelActionIndex);
  channelActionIndexRef.current = channelActionIndex;
  const runningSessions = useMemo(
    () => Array.from(state.sessions.values()).filter((session) => session.status !== "exited"),
    [state.sessions],
  );
  const activeRunningSession = useMemo(() => {
    if (state.activeSessionId) {
      const active = state.sessions.get(state.activeSessionId);
      if (active && active.status !== "exited") {
        return active;
      }
    }

    return runningSessions[0] ?? null;
  }, [runningSessions, state.activeSessionId, state.sessions]);
  const dispatchItems = useMemo(() => {
    const nextItems: Array<{ label: string; value: string }> = [];

    if (activeRunningSession) {
      nextItems.push({
        label: `Return to running lane — ${formatLaneLabel(activeRunningSession)}`,
        value: "return-to-active-lane",
      });
    }

    nextItems.push(
      { label: "Start Sessions — configure and launch monitoring", value: "session-setup" },
      { label: "Onboard Project — analyze a repo or define a new project vision", value: "onboarding" },
      { label: "Exit", value: "exit" },
    );

    return nextItems;
  }, [activeRunningSession]);
  const roscoeSettings = useMemo(
    () => loadRoscoeSettings(),
    [wireRevision],
  );
  const roscoeActions = useMemo(() => ([
    {
      key: "auto-heal-metadata",
      label: "Auto-heal metadata",
      value: roscoeSettings.behavior.autoHealMetadata ? "On" : "Off",
      description: "When enabled, Roscoe can reinterpret stale lane/session metadata at startup and reopen dead lanes from saved history instead of blindly resuming dead native sessions.",
    },
    {
      key: "park-at-milestones",
      label: "Park at large milestones for human review",
      value: roscoeSettings.behavior.parkAtMilestonesForReview ? "On" : "Off",
      description: "When enabled, Roscoe may park a lane at a major milestone and wait for human review before opening the next thread. Off by default: Roscoe should keep planning the next slice until the app is actually complete or blocked.",
    },
    {
      key: "prevent-sleep",
      label: "Prevent sleep while Roscoe runs",
      value: roscoeSettings.behavior.preventSleepWhileRunning ? "On" : "Off",
      description: "When enabled, Roscoe uses native OS keep-awake helpers while it runs: macOS uses caffeinate, Windows uses SetThreadExecutionState via PowerShell. This only affects local machine sleep, not Roscoe's own runtime logic.",
    },
  ]), [roscoeSettings.behavior.autoHealMetadata, roscoeSettings.behavior.parkAtMilestonesForReview, roscoeSettings.behavior.preventSleepWhileRunning]);
  const notificationStatus = useMemo(
    () => notifier.getStatus(),
    [notifier, wireRevision],
  );
  const channelRoute = roscoeSettings.notifications.deliveryMode;
  const cleanedNotificationPhone = cleanPhoneNumber(roscoeSettings.notifications.phoneNumber);
  const hostedTestVerified = Boolean(
    cleanedNotificationPhone
    && roscoeSettings.notifications.hostedTestVerifiedPhone === cleanedNotificationPhone,
  );
  const hostedRelayLinked = Boolean(
    cleanedNotificationPhone
    && roscoeSettings.notifications.hostedRelayLinkedPhone === cleanedNotificationPhone
    && roscoeSettings.notifications.hostedRelayAccessToken,
  );
  const activeProvider = discoveredProviders[providerTabIndex] ?? discoveredProviders[0] ?? null;
  const providerActions = useMemo(() => {
    if (!activeProvider) return [];

    const providerSettings = roscoeSettings.providers[activeProvider.id];
    const actions = [
      {
        key: "enabled",
        label: `${getProviderLabel(activeProvider.id)} availability`,
        value: providerSettings.enabled ? "Enabled" : "Hidden from new-lane choices",
        description: `Press Enter to ${providerSettings.enabled ? "hide" : "enable"} ${getProviderLabel(activeProvider.id)} for new Roscoe lanes.`,
      },
    ];

    for (const toggle of activeProvider.managedToggles.filter((item) => item.supported)) {
      const enabled = activeProvider.id === "codex"
        ? toggle.key === "webSearch" && roscoeSettings.providers.codex.webSearch
        : activeProvider.id === "claude"
          ? (
            (toggle.key === "brief" && roscoeSettings.providers.claude.brief)
            || (toggle.key === "ide" && roscoeSettings.providers.claude.ide)
            || (toggle.key === "chrome" && roscoeSettings.providers.claude.chrome)
          )
          : false;
      actions.push({
        key: toggle.key,
        label: toggle.label,
        value: enabled ? "On" : "Off",
        description: toggle.description,
      });
    }

    return actions;
  }, [activeProvider, roscoeSettings.providers]);
  const monthlyPlan = hostedPlans.find((plan) => plan.interval === "month");
  const annualPlan = hostedPlans.find((plan) => plan.interval === "year");
  const channelActions = useMemo(() => {
    if (channelRoute === "unconfigured") {
      return [
        {
          key: "route-hosted",
          label: "Roscoe-hosted",
          value: monthlyPlan ? `${formatPlanAmount(monthlyPlan.amount, monthlyPlan.currency)}/${monthlyPlan.interval}` : "Hosted relay",
          description: "Use roscoe.sh to host SMS and webhook ingress, route messages back to your CLI, and handle billing centrally.",
        },
        {
          key: "route-self-hosted",
          label: "Self-hosted",
          value: ".env.local",
          description: "Run SMS and webhook delivery from your own machine with local provider credentials loaded from the active project's .env.local.",
        },
      ];
    }

    if (channelRoute === "roscoe-hosted") {
      return [
        {
          key: "route",
          label: "Channel Route",
          value: "Roscoe-hosted",
          description: "Hosted relay uses roscoe.sh for Twilio/webhook ingress and forwards approved messages back into your local Roscoe CLI.",
        },
        {
          key: "phone",
          label: "Phone Number",
          value: notificationStatus.phoneNumber || "No phone saved yet.",
          description: "Press Enter to add or edit the destination number. Roscoe uses this number for hosted SMS verification and relay control.",
        },
        {
          key: "hosted-test",
          label: "Send Hosted Test SMS",
          value: wireBusy
            ? "Sending..."
            : hostedRelayLinked
              ? "Round trip ready"
              : "Link account first",
          description: hostedRelayLinked
            ? "Press Enter to send another hosted round-trip test SMS."
            : "Open Checkout first so roscoe.sh can link this CLI to a Roscoe account before you test the hosted round trip.",
        },
        {
          key: "hosted-checkout",
          label: "Checkout",
          value: hostedStatus?.active
            ? "Active"
            : monthlyPlan
              ? `${formatPlanAmount(monthlyPlan.amount, monthlyPlan.currency)}/${monthlyPlan.interval}${annualPlan ? ` · annual ${formatPlanAmount(annualPlan.amount, annualPlan.currency)}/${annualPlan.interval}` : ""}`
              : "Loading pricing...",
          description: hostedStatus?.active
            ? "Subscription is already active for this phone."
            : "Press Enter to open roscoe.sh in your browser, sign in or create a Roscoe account, and continue checkout there.",
        },
        {
          key: "route-reset",
          label: "Reset Route",
          value: "Choose again",
          description: "Go back and choose between Roscoe-hosted and self-hosted channels.",
        },
      ];
    }

    return [
      {
        key: "route",
        label: "Channel Route",
        value: "Self-hosted",
        description: "Roscoe reads provider credentials from the active project's .env.local and keeps delivery under your control.",
      },
      {
        key: "phone",
        label: "Phone Number",
        value: notificationStatus.phoneNumber || "No phone saved yet.",
        description: "Press Enter to add or edit the destination number.",
      },
      {
        key: "sms",
        label: "SMS Wire",
        value: notificationStatus.enabled ? "Armed" : "Paused",
        description: "Press Enter to toggle milestone texts, intervention alerts, and reply-by-text on or off. Phone consent is required first.",
      },
      {
        key: "test",
        label: "Send Test SMS",
        value: wireBusy ? "Sending..." : "Ready",
        description: "Press Enter to send a Roscoe test wire now.",
      },
      {
        key: "route-reset",
        label: "Reset Route",
        value: "Choose again",
        description: "Go back and choose between Roscoe-hosted and self-hosted channels.",
      },
    ];
  }, [
    annualPlan,
    channelRoute,
    hostedRelayLinked,
    hostedStatus,
    hostedTestVerified,
    monthlyPlan,
    notificationStatus.enabled,
    notificationStatus.phoneNumber,
    roscoeSettings.notifications.hostedRelayLinkedEmail,
    wireBusy,
  ]);

  const handleIntroDone = () => {
    dbg("home:action", "intro=done");
    hasShownRoscoeIntro = true;
    setShowIntro(false);
  };

  const maybePersistHostedRelayLink = (snapshot: HostedRelayLinkSnapshot | null | undefined, fallbackPhone: string): boolean => {
    if (!snapshot?.accessToken && !snapshot?.refreshToken) {
      return false;
    }

    const linkedPhone = cleanPhoneNumber(snapshot.linkedPhone ?? snapshot.phone ?? fallbackPhone);
    const latest = loadRoscoeSettings();
    saveRoscoeSettings({
      ...latest,
      notifications: {
        ...latest.notifications,
        phoneNumber: fallbackPhone,
        hostedRelayAccessToken: snapshot.accessToken ?? latest.notifications.hostedRelayAccessToken,
        hostedRelayAccessTokenExpiresAt: snapshot.accessTokenExpiresAt ?? latest.notifications.hostedRelayAccessTokenExpiresAt,
        hostedRelayRefreshToken: snapshot.refreshToken ?? latest.notifications.hostedRelayRefreshToken,
        hostedRelayLinkedPhone: linkedPhone || latest.notifications.hostedRelayLinkedPhone,
        hostedRelayLinkedEmail: snapshot.userEmail ?? latest.notifications.hostedRelayLinkedEmail,
      },
    });
    setWireRevision((value) => value + 1);
    return true;
  };

  useEffect(() => {
    dbg(
      "home",
      `tab=${activeTab} focus=${focusArea} dispatch=${dispatchIndex} providerTab=${providerTabIndex} providerAction=${providerActionIndex} roscoeAction=${roscoeActionIndex} channelAction=${channelActionIndex} editing=${editingChannelField ?? "off"} consent=${pendingConsentPhone ? "pending" : "off"} pending=${pendingDispatchTarget ?? "none"} intro=${showIntro ? "on" : "off"}`,
    );
  }, [
    activeTab,
    channelActionIndex,
    dispatchIndex,
    editingChannelField,
    focusArea,
    pendingConsentPhone,
    pendingDispatchTarget,
    providerActionIndex,
    providerTabIndex,
    roscoeActionIndex,
    showIntro,
  ]);

  useEffect(() => {
    if (!pendingDispatchTarget) return;

    const timer = setTimeout(() => {
      if (pendingDispatchTarget === "session-setup") {
        dispatch({ type: "OPEN_SESSION_SETUP" });
      } else {
        dispatch({ type: "OPEN_ONBOARDING", request: { mode: "onboard" } });
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [dispatch, pendingDispatchTarget]);

  useEffect(() => {
    dbg("home:providers", "status=loading");
    setProviderDiscoveryStatus("loading");
    setProviderMessage(null);
    let cancelled = false;

    void discoverProvidersAsync()
      .then((providers) => {
        if (cancelled) return;
        const installedProviders = providers.filter((provider) => provider.installed);
        dbg("home:providers", `status=ready count=${installedProviders.length}`);
        setDiscoveredProviders(installedProviders);
        setProviderDiscoveryStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        dbg("home:providers", `status=failed detail=${detail}`);
        setDiscoveredProviders([]);
        setProviderMessage({
          text: `Provider scan failed: ${detail}`,
          color: "red",
        });
        setProviderDiscoveryStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (providerTabIndex < discoveredProviders.length || discoveredProviders.length === 0) {
      return;
    }
    setProviderTabIndex(0);
  }, [discoveredProviders.length, providerTabIndex]);

  useEffect(() => {
    if (process.env.VITEST || channelRoute !== "roscoe-hosted") {
      if (channelRoute !== "roscoe-hosted") {
        setHostedPlans([]);
        setHostedStatus(null);
      }
      return;
    }

    let cancelled = false;
    const relayBaseUrl = getRelayBaseUrl();

    const loadPlans = async () => {
      try {
        const plansResponse = await fetch(new URL("/api/relay/billing/plans", relayBaseUrl));
        if (plansResponse.ok) {
          const payload = await plansResponse.json() as { ok: boolean; plans?: HostedRelayPlan[] };
          if (!cancelled && Array.isArray(payload.plans)) {
            setHostedPlans(payload.plans);
          }
        }
      } catch {
        if (!cancelled) {
          setHostedPlans([]);
        }
      }
    };

    const syncStatus = async () => {
      const phone = cleanPhoneNumber(roscoeSettings.notifications.phoneNumber);
      if (!phone) {
        if (!cancelled) setHostedStatus(null);
        return;
      }

      try {
        const statusUrl = new URL("/api/relay/billing/status", relayBaseUrl);
        statusUrl.searchParams.set("phone", phone);
        statusUrl.searchParams.set("clientId", ensureHostedRelayClientId());
        const statusResponse = await fetch(statusUrl);
        if (!statusResponse.ok) return;
        const payload = await statusResponse.json() as { ok: boolean; status?: HostedRelayStatus };
        if (!cancelled && payload.status) {
          maybePersistHostedRelayLink(payload.status, phone);
          const latestSettings = loadRoscoeSettings();
          if (payload.status.roundTripVerified && latestSettings.notifications.hostedTestVerifiedPhone !== phone) {
            saveRoscoeSettings({
              ...latestSettings,
              notifications: {
                ...latestSettings.notifications,
                hostedTestVerifiedPhone: phone,
              },
            });
            setWireRevision((value) => value + 1);
          }
          setHostedStatus(payload.status);
        }
      } catch {
        if (!cancelled) {
          setHostedStatus(null);
        }
      }
    };

    void loadPlans();
    void syncStatus();
    const interval = setInterval(() => {
      void syncStatus();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [channelRoute, roscoeSettings.notifications.phoneNumber]);

  const setChannelRoute = (nextRoute: "self-hosted" | "roscoe-hosted" | "unconfigured") => {
    dbg("home:channel", `route=${nextRoute}`);
    saveRoscoeSettings({
      ...roscoeSettings,
      notifications: {
        ...roscoeSettings.notifications,
        deliveryMode: nextRoute,
        enabled: nextRoute === "roscoe-hosted" ? false : roscoeSettings.notifications.enabled,
        ...(nextRoute === "unconfigured"
          ? {
              hostedTestVerifiedPhone: "",
              hostedRelayAccessToken: "",
              hostedRelayAccessTokenExpiresAt: "",
              hostedRelayRefreshToken: "",
              hostedRelayLinkedPhone: "",
              hostedRelayLinkedEmail: "",
            }
          : {}),
      },
    });
    setWireRevision((value) => value + 1);
    setChannelActionIndex(0);
    setWireMessage({
      text: nextRoute === "roscoe-hosted"
        ? "Roscoe-hosted relay selected. Save a phone number, then open checkout to sign in or create a Roscoe account on roscoe.sh."
        : nextRoute === "self-hosted"
          ? "Self-hosted delivery selected. Gather the local env vars and save them in the active project's .env.local."
          : "Channel route cleared. Choose Roscoe-hosted or self-hosted to continue.",
      color: nextRoute === "unconfigured" ? "yellow" : "green",
    });
  };

  const selectHomeTab = (tab: HomeTab) => {
    dbg("home:action", `tab=${tab}`);
    setActiveTab(tab);
    setFocusArea("tabs");
  };

  const handleSelect = (value: string) => {
    dbg("home:action", `dispatch=${value}`);
    switch (value) {
      case "return-to-active-lane":
        if (activeRunningSession) {
          dispatch({ type: "SET_ACTIVE", id: activeRunningSession.id });
          dispatch({ type: "SET_SCREEN", screen: "session-view" });
        }
        break;
      case "session-setup":
        setPendingDispatchTarget("session-setup");
        break;
      case "onboarding":
        setPendingDispatchTarget("onboarding");
        break;
      case "exit":
        process.exit(0);
    }
  };

  const saveProviderSettings = (
    updater: (current: typeof roscoeSettings.providers) => typeof roscoeSettings.providers,
    message: { text: string; color: "green" | "red" | "yellow" },
  ) => {
    saveRoscoeSettings({
      ...roscoeSettings,
      providers: updater(roscoeSettings.providers),
    });
    setWireRevision((value) => value + 1);
    setProviderMessage(message);
  };

  const toggleProviderAction = (actionKey: string) => {
    if (!activeProvider) return;
    dbg("home:provider", `provider=${activeProvider.id} action=${actionKey}`);

    if (actionKey === "enabled") {
      if (
        roscoeSettings.providers[activeProvider.id].enabled
        && discoveredProviders
          .filter((provider) => provider.installed && !provider.comingSoon)
          .filter((provider) => roscoeSettings.providers[provider.id].enabled).length === 1
      ) {
        setProviderMessage({
          text: "Keep at least one supported provider enabled for new lanes.",
          color: "yellow",
        });
        return;
      }
      saveProviderSettings((current) => ({
        ...current,
        [activeProvider.id]: {
          ...current[activeProvider.id],
          enabled: !current[activeProvider.id].enabled,
        },
      }), {
        text: `${getProviderLabel(activeProvider.id)} is now ${roscoeSettings.providers[activeProvider.id].enabled ? "hidden from new choices" : "enabled for new choices"}.`,
        color: roscoeSettings.providers[activeProvider.id].enabled ? "yellow" : "green",
      });
      return;
    }

    if (activeProvider.id === "codex" && actionKey === "webSearch") {
      saveProviderSettings((current) => ({
        ...current,
        codex: {
          ...current.codex,
          webSearch: !current.codex.webSearch,
        },
      }), {
        text: `Codex live web search ${roscoeSettings.providers.codex.webSearch ? "disabled" : "enabled"} for new turns.`,
        color: roscoeSettings.providers.codex.webSearch ? "yellow" : "green",
      });
      return;
    }

    if (activeProvider.id === "claude" && (actionKey === "brief" || actionKey === "ide" || actionKey === "chrome")) {
      const claudeActionKey = actionKey as "brief" | "ide" | "chrome";
      const label = claudeActionKey === "brief" ? "Claude brief mode" : claudeActionKey === "ide" ? "Claude IDE attach" : "Claude Chrome bridge";
      const currentValue = roscoeSettings.providers.claude[claudeActionKey];
      saveProviderSettings((current) => ({
        ...current,
        claude: {
          ...current.claude,
          [claudeActionKey]: !current.claude[claudeActionKey],
        },
      }), {
        text: `${label} ${currentValue ? "disabled" : "enabled"} for new turns.`,
        color: currentValue ? "yellow" : "green",
      });
    }
  };

  const toggleSmsUpdates = () => {
    const nextEnabled = !roscoeSettings.notifications.enabled;
    if (nextEnabled && !cleanPhoneNumber(roscoeSettings.notifications.phoneNumber)) {
      setWireMessage({ text: "Add a phone number before arming SMS updates.", color: "yellow" });
      return;
    }
    if (nextEnabled && !roscoeSettings.notifications.consentAcknowledged) {
      setWireMessage({ text: "Save a phone number and accept the SMS consent notice before arming SMS updates.", color: "yellow" });
      return;
    }
    saveRoscoeSettings({
      ...roscoeSettings,
      notifications: {
        ...roscoeSettings.notifications,
        enabled: nextEnabled,
      },
    });
    setWireRevision((value) => value + 1);
    setWireMessage({
      text: nextEnabled ? "Roscoe will text milestones and intervention requests, and accept SMS replies." : "Roscoe SMS wire paused.",
      color: nextEnabled ? "green" : "yellow",
    });
  };

  const sendTestSms = () => {
    if (wireBusy) return;
    setWireBusy(true);
    setWireMessage({ text: "Sending Roscoe test wire...", color: "yellow" });
    notifier.sendTestMessage()
      .then((result) => {
        setWireMessage({
          text: result.detail,
          color: result.ok ? (result.delivered ? "green" : "yellow") : "red",
        });
      })
      .catch((error: unknown) => {
        setWireMessage({
          text: error instanceof Error ? error.message : "Failed to send test text.",
          color: "red",
        });
      })
      .finally(() => {
        setWireBusy(false);
        setWireRevision((value) => value + 1);
      });
  };

  const sendHostedTestSms = () => {
    if (wireBusy) return;
    const phone = cleanPhoneNumber(roscoeSettings.notifications.phoneNumber);
    if (!phone) {
      setWireMessage({ text: "Add a phone number before sending a hosted test SMS.", color: "yellow" });
      return;
    }
    if (!roscoeSettings.notifications.consentAcknowledged) {
      setWireMessage({ text: "Accept SMS consent before sending a hosted test SMS.", color: "yellow" });
      return;
    }
    if (!hostedRelayLinked) {
      setWireMessage({
        text: "Open Checkout first so roscoe.sh can link this CLI to your Roscoe account before you send a hosted test SMS.",
        color: "yellow",
      });
      return;
    }

    if (roscoeSettings.notifications.hostedTestVerifiedPhone === phone) {
      saveRoscoeSettings({
        ...roscoeSettings,
        notifications: {
          ...roscoeSettings.notifications,
          hostedTestVerifiedPhone: "",
        },
      });
      setWireRevision((value) => value + 1);
    }

    setWireBusy(true);
    setWireMessage({ text: "Sending Roscoe-hosted test SMS...", color: "yellow" });
    const relayBaseUrl = getRelayBaseUrl();
    const clientId = ensureHostedRelayClientId();
    fetch(new URL("/api/relay/sms/test", relayBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, clientId }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({} as HostedRelaySmsStatus));
        if (!response.ok) {
          throw new Error(payload.error || "Failed to send hosted test SMS.");
        }
        const finalResult = payload.sid && !payload.delivered && !payload.terminal
          ? await pollHostedTestSmsStatus(relayBaseUrl, payload.sid)
          : payload;

        if (finalResult.roundTripVerified) {
          saveRoscoeSettings({
            ...roscoeSettings,
            notifications: {
              ...roscoeSettings.notifications,
              hostedTestVerifiedPhone: phone,
            },
          });
          setWireRevision((value) => value + 1);
        }

        maybePersistHostedRelayLink(finalResult, phone);
        setWireMessage(describeHostedSmsResult(phone, finalResult));
      })
      .catch((error: unknown) => {
        setWireMessage({
          text: error instanceof Error ? error.message : "Failed to send hosted test SMS.",
          color: "red",
        });
      })
      .finally(() => {
        setWireBusy(false);
      });
  };

  const openHostedCheckout = () => {
    if (wireBusy) return;
    const phone = cleanPhoneNumber(roscoeSettings.notifications.phoneNumber);
    if (!phone) {
      setWireMessage({ text: "Save a phone number before opening hosted checkout.", color: "yellow" });
      return;
    }
    if (!roscoeSettings.notifications.consentAcknowledged) {
      setWireMessage({ text: "Accept SMS consent before opening hosted checkout.", color: "yellow" });
      return;
    }

    setWireBusy(true);
    setWireMessage({ text: "Opening roscoe.sh hosted checkout...", color: "yellow" });
    const relayBaseUrl = getRelayBaseUrl();
    const clientId = ensureHostedRelayClientId();
    startHostedRelayDeviceLink(relayBaseUrl, phone, clientId)
      .then(async (result) => {
        if (!result.ok) {
          throw new Error(result.error || "Unable to start Roscoe account checkout.");
        }
        if (!result.deviceCode) {
          throw new Error("roscoe.sh did not return a device code for hosted checkout.");
        }

        const verificationUrl = result.verificationUrlComplete || result.verificationUrl;
        if (!verificationUrl) {
          throw new Error("roscoe.sh did not return a browser URL for hosted checkout.");
        }

        const setupUrl = new URL(verificationUrl);
        setupUrl.searchParams.set("intent", "checkout");

        try {
          await openExternalUrl(setupUrl.toString());
          setWireMessage({
            text: "Opened roscoe.sh in your browser. Sign in or create a Roscoe account there, then continue checkout.",
            color: "green",
          });
        } catch {
          setWireMessage({
            text: `Continue hosted setup: ${setupUrl.toString()}`,
            color: "green",
          });
        }

        void (async () => {
          for (let attempt = 0; attempt < 90; attempt += 1) {
            const pollResult = await pollHostedRelayDeviceLink(relayBaseUrl, result.deviceCode!, clientId);
            if (!pollResult.ok) {
              throw new Error(pollResult.error || "Unable to finish Roscoe account linking.");
            }
            if (pollResult.status === "linked") {
              maybePersistHostedRelayLink(pollResult, phone);
              setWireMessage({
                text: "Roscoe account linked. Finish hosted checkout in your browser, then send the hosted test SMS.",
                color: "green",
              });
              setWireRevision((value) => value + 1);
              return;
            }

            await new Promise((resolve) => setTimeout(resolve, (pollResult.pollIntervalSeconds || result.pollIntervalSeconds || 2) * 1000));
          }
        })().catch((error: unknown) => {
          setWireMessage({
            text: error instanceof Error ? error.message : "Hosted account approval is still pending in your browser.",
            color: "yellow",
          });
        });
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : "Unable to start Roscoe account checkout.";
        if (/Hosted relay (browser approval|auth) is not configured/i.test(detail)) {
          requestHostedCheckoutSession(relayBaseUrl, phone, clientId)
            .then(async (result) => {
              maybePersistHostedRelayLink(result, phone);
              try {
                await openExternalUrl(result.url);
                setWireMessage({
                  text: "Opened hosted checkout in your browser.",
                  color: "green",
                });
              } catch {
                setWireMessage({
                  text: `Hosted checkout ready: ${result.url}`,
                  color: "green",
                });
              }
            })
            .catch((fallbackError: unknown) => {
              setWireMessage({
                text: fallbackError instanceof Error ? fallbackError.message : "Failed to create hosted relay checkout session.",
                color: "red",
              });
            })
            .finally(() => {
              setWireBusy(false);
              setWireRevision((value) => value + 1);
            });
          return;
        }

        setWireMessage({
          text: detail,
          color: "red",
        });
      })
      .finally(() => {
        setWireBusy(false);
        setWireRevision((value) => value + 1);
      });
  };

  const activeHints = useMemo(() => {
    if (pendingDispatchTarget) {
      return [];
    }

    if (pendingConsentPhone) {
      return [
        { keyLabel: "←/→", description: "choose action" },
        { keyLabel: "Enter", description: "confirm" },
        { keyLabel: "Esc", description: "cancel" },
      ];
    }

    if (editingChannelField) {
      return [
        { keyLabel: "Enter", description: "save number" },
        { keyLabel: "Esc", description: "cancel edit" },
      ];
    }

    if (focusArea === "tabs") {
      return [
        { keyLabel: "←/→", description: "switch tab" },
        { keyLabel: "↓", description: "enter panel" },
      ];
    }

    if (activeTab === "dispatch") {
      return [
        { keyLabel: "↑/↓", description: "move selection" },
        { keyLabel: "Enter", description: "launch path" },
        { keyLabel: "←/→", description: "switch tab" },
      ];
    }

    if (activeTab === "providers" && focusArea === "provider-tabs") {
      return [
        { keyLabel: "←/→", description: "switch provider" },
        { keyLabel: "↓", description: "choose action" },
        { keyLabel: "↑", description: "back to tabs" },
      ];
    }

    if (activeTab === "providers" && focusArea === "provider-actions") {
      return [
        { keyLabel: "↑/↓", description: "move action" },
        { keyLabel: "Enter", description: "toggle" },
        { keyLabel: "←/→", description: "provider tabs" },
      ];
    }

    if (activeTab === "roscoe" && focusArea === "roscoe-actions") {
      return [
        { keyLabel: "↑/↓", description: "move action" },
        { keyLabel: "Enter", description: "toggle" },
        { keyLabel: "←/→", description: "switch tab" },
      ];
    }

    if (activeTab === "channel" && focusArea === "channel-actions") {
      return [
        { keyLabel: "↑/↓", description: "move action" },
        { keyLabel: "Enter", description: "activate" },
        { keyLabel: "←/→", description: "switch tab" },
      ];
    }
    return [];
  }, [activeTab, editingChannelField, focusArea, pendingConsentPhone, pendingDispatchTarget]);

  useInput((input, key) => {
    dbg(
      "home:key",
      `key=${describeHomeKey(input, key)} tab=${activeTab} focus=${focusArea} editing=${editingChannelField ?? "off"} consent=${pendingConsentPhone ? "pending" : "off"} pending=${pendingDispatchTarget ?? "none"} intro=${showIntro ? "on" : "off"}`,
    );

    const isEnter = key.return || input === "\r" || input === "\n";

    if (showIntro) return;
    if (pendingDispatchTarget) return;
    if (pendingConsentPhone) {
      if (key.leftArrow || key.upArrow || (key.shift && key.tab)) {
        setConsentDialogIndex(0);
        return;
      }
      if (key.rightArrow || key.downArrow || key.tab) {
        setConsentDialogIndex(1);
        return;
      }
      if (key.escape || (isEnter && consentDialogIndex === 1)) {
        saveRoscoeSettings({
          ...roscoeSettings,
          notifications: {
            ...roscoeSettings.notifications,
            phoneNumber: "",
            enabled: false,
            consentAcknowledged: false,
            hostedTestVerifiedPhone: "",
            hostedRelayAccessToken: "",
            hostedRelayAccessTokenExpiresAt: "",
            hostedRelayRefreshToken: "",
            hostedRelayLinkedPhone: "",
            hostedRelayLinkedEmail: "",
          },
        });
        setWireRevision((value) => value + 1);
        setPendingConsentPhone(null);
        setPendingConsentSnapshot(null);
        setConsentDialogIndex(0);
        setWireDraft("");
        setWireMessage({
          text: "Phone number cleared. SMS consent was not accepted.",
          color: "yellow",
        });
        return;
      }
      if (isEnter && consentDialogIndex === 0) {
        saveRoscoeSettings({
          ...roscoeSettings,
          notifications: {
            ...roscoeSettings.notifications,
            phoneNumber: pendingConsentPhone,
            consentAcknowledged: true,
            hostedTestVerifiedPhone:
              pendingConsentSnapshot?.hostedTestVerifiedPhone === pendingConsentPhone
                ? pendingConsentSnapshot.hostedTestVerifiedPhone
                : "",
            hostedRelayAccessToken:
              pendingConsentSnapshot?.hostedRelayLinkedPhone === pendingConsentPhone
                ? pendingConsentSnapshot.hostedRelayAccessToken
                : "",
            hostedRelayAccessTokenExpiresAt:
              pendingConsentSnapshot?.hostedRelayLinkedPhone === pendingConsentPhone
                ? pendingConsentSnapshot.hostedRelayAccessTokenExpiresAt
                : "",
            hostedRelayRefreshToken:
              pendingConsentSnapshot?.hostedRelayLinkedPhone === pendingConsentPhone
                ? pendingConsentSnapshot.hostedRelayRefreshToken
                : "",
            hostedRelayLinkedPhone:
              pendingConsentSnapshot?.hostedRelayLinkedPhone === pendingConsentPhone
                ? pendingConsentSnapshot.hostedRelayLinkedPhone
                : "",
            hostedRelayLinkedEmail:
              pendingConsentSnapshot?.hostedRelayLinkedPhone === pendingConsentPhone
                ? pendingConsentSnapshot.hostedRelayLinkedEmail
                : "",
          },
        });
        setWireRevision((value) => value + 1);
        setPendingConsentPhone(null);
        setPendingConsentSnapshot(null);
        setConsentDialogIndex(0);
        setWireDraft(pendingConsentPhone);
        setWireMessage({
          text: `Saved ${pendingConsentPhone}. SMS consent accepted.`,
          color: "green",
        });
        return;
      }
      return;
    }

    if (editingChannelField) {
      if (key.escape) {
        setEditingChannelField(null);
        setWireDraft(roscoeSettings.notifications.phoneNumber);
        setWireMessage(null);
      }
      return;
    }

    if (focusArea === "tabs") {
      if (key.leftArrow || (key.shift && key.tab)) {
        const currentIndex = HOME_TABS.findIndex((tab) => tab.value === activeTab);
        const nextIndex = currentIndex <= 0 ? HOME_TABS.length - 1 : currentIndex - 1;
        selectHomeTab(HOME_TABS[nextIndex].value);
        return;
      }

      if (key.rightArrow || key.tab) {
        const currentIndex = HOME_TABS.findIndex((tab) => tab.value === activeTab);
        const nextIndex = currentIndex >= HOME_TABS.length - 1 ? 0 : currentIndex + 1;
        selectHomeTab(HOME_TABS[nextIndex].value);
        return;
      }

      if (key.downArrow) {
        if (activeTab === "dispatch") {
          setFocusArea("dispatch");
        } else if (activeTab === "providers") {
          setFocusArea("provider-tabs");
        } else if (activeTab === "roscoe") {
          setFocusArea("roscoe-actions");
          setRoscoeActionIndex(0);
        } else if (activeTab === "channel") {
          setFocusArea("channel-actions");
          setChannelActionIndex(0);
        }
        return;
      }
    }

    if (activeTab === "dispatch" && focusArea === "dispatch") {
      if (key.leftArrow || (key.shift && key.tab)) {
        const currentIndex = HOME_TABS.findIndex((tab) => tab.value === activeTab);
        const nextIndex = currentIndex <= 0 ? HOME_TABS.length - 1 : currentIndex - 1;
        selectHomeTab(HOME_TABS[nextIndex].value);
        return;
      }

      if (key.rightArrow || key.tab) {
        const currentIndex = HOME_TABS.findIndex((tab) => tab.value === activeTab);
        const nextIndex = currentIndex >= HOME_TABS.length - 1 ? 0 : currentIndex + 1;
        selectHomeTab(HOME_TABS[nextIndex].value);
        return;
      }

      if (key.upArrow) {
        if (dispatchIndex === 0) {
          setFocusArea("tabs");
        } else {
          setDispatchIndex((value) => Math.max(0, value - 1));
        }
        return;
      }

      if (key.downArrow) {
        setDispatchIndex((value) => Math.min(dispatchItems.length - 1, value + 1));
        return;
      }

      if (isEnter) {
        handleSelect(dispatchItems[dispatchIndex].value);
        return;
      }
    }

    if (activeTab === "providers" && focusArea === "provider-tabs") {
      if (key.upArrow) {
        setFocusArea("tabs");
        return;
      }

      if (key.leftArrow || (key.shift && key.tab)) {
        setProviderTabIndex((value) => (value <= 0 ? Math.max(0, discoveredProviders.length - 1) : value - 1));
        setProviderActionIndex(0);
        setProviderMessage(null);
        return;
      }

      if (key.rightArrow || key.tab) {
        setProviderTabIndex((value) => (value >= discoveredProviders.length - 1 ? 0 : value + 1));
        setProviderActionIndex(0);
        setProviderMessage(null);
        return;
      }

      if (key.downArrow || isEnter) {
        if (providerActions.length > 0) {
          setFocusArea("provider-actions");
        }
        return;
      }
    }

    if (activeTab === "providers" && focusArea === "provider-actions") {
      if (key.upArrow) {
        if (providerActionIndex === 0) {
          setFocusArea("provider-tabs");
        } else {
          setProviderActionIndex((value) => Math.max(0, value - 1));
        }
        return;
      }

      if (key.downArrow) {
        setProviderActionIndex((value) => Math.min(providerActions.length - 1, value + 1));
        return;
      }

      if (key.leftArrow || key.rightArrow || key.tab || (key.shift && key.tab)) {
        setFocusArea("provider-tabs");
        return;
      }

      if (isEnter) {
        const action = providerActions[providerActionIndexRef.current];
        if (action) {
          toggleProviderAction(action.key);
        }
        return;
      }
    }

    if (activeTab === "roscoe" && focusArea === "roscoe-actions") {
      if (key.upArrow) {
        if (roscoeActionIndex === 0) {
          setFocusArea("tabs");
        } else {
          setRoscoeActionIndex((value) => Math.max(0, value - 1));
        }
        return;
      }

      if (key.downArrow) {
        setRoscoeActionIndex((value) => Math.min(roscoeActions.length - 1, value + 1));
        return;
      }

      if (key.leftArrow || key.rightArrow || key.tab || (key.shift && key.tab)) {
        const currentIndex = HOME_TABS.findIndex((tab) => tab.value === activeTab);
        const nextIndex = key.leftArrow || (key.shift && key.tab)
          ? (currentIndex <= 0 ? HOME_TABS.length - 1 : currentIndex - 1)
          : (currentIndex >= HOME_TABS.length - 1 ? 0 : currentIndex + 1);
        selectHomeTab(HOME_TABS[nextIndex].value);
        return;
      }

      if (isEnter) {
        const action = roscoeActions[roscoeActionIndexRef.current];
        if (!action) {
          return;
        }

        dbg("home:roscoe", `action=${action.key}`);
        const result = applyRoscoeAction(roscoeSettings, action.key as RoscoeActionKey);
        saveRoscoeSettings(result.settings);
        if (action.key === "prevent-sleep" && typeof result.keepAwakeEnabled === "boolean") {
          setRoscoeKeepAwakeEnabled(result.keepAwakeEnabled);
        }
        setWireRevision((value) => value + 1);
        setRoscoeMessage(result.message);
        return;
      }
    }

    if (activeTab === "channel" && focusArea === "channel-actions") {
      if (key.upArrow) {
        if (channelActionIndex === 0) {
          setFocusArea("tabs");
        } else {
          setChannelActionIndex((value) => Math.max(0, value - 1));
        }
        return;
      }

      if (key.downArrow) {
        setChannelActionIndex((value) => Math.min(channelActions.length - 1, value + 1));
        return;
      }

      if (key.leftArrow || key.rightArrow || key.tab || (key.shift && key.tab)) {
        const currentIndex = HOME_TABS.findIndex((tab) => tab.value === activeTab);
        const nextIndex = key.leftArrow || (key.shift && key.tab)
          ? (currentIndex <= 0 ? HOME_TABS.length - 1 : currentIndex - 1)
          : (currentIndex >= HOME_TABS.length - 1 ? 0 : currentIndex + 1);
        selectHomeTab(HOME_TABS[nextIndex].value);
        return;
      }

      if (isEnter) {
        const action = channelActions[channelActionIndexRef.current]?.key;
        dbg("home:channel", `action=${action ?? "none"}`);
        if (action === "route-hosted") {
          setChannelRoute("roscoe-hosted");
          return;
        }
        if (action === "route-self-hosted") {
          setChannelRoute("self-hosted");
          return;
        }
        if (action === "route-reset") {
          setChannelRoute("unconfigured");
          return;
        }
        if (action === "phone") {
          setEditingChannelField("phone");
          setWireDraft(roscoeSettings.notifications.phoneNumber);
          setWireMessage(null);
          return;
        }
        if (action === "sms") {
          toggleSmsUpdates();
          return;
        }
        if (action === "test") {
          sendTestSms();
          return;
        }
        if (action === "hosted-test") {
          sendHostedTestSms();
          return;
        }
        if (action === "hosted-checkout") {
          openHostedCheckout();
          return;
        }
        return;
      }
    }

  });

  if (showIntro) {
    return <RoscoeIntro onDone={handleIntroDone} />;
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Panel
        title="ROSCOE DISPATCH"
        subtitle="Roscoe at the desk. Guild workers in the field."
        accentColor="cyan"
        rightLabel={`${projects.length} remembered`}
      >
        <Text bold>Track provider lanes, judge the next wire, and keep every Guild lane aligned with the brief.</Text>
        <Box marginTop={1}>
          <KeyHints items={activeHints} />
        </Box>
      </Panel>

      <Panel
        title="Home Tabs"
        subtitle="Arrow across Roscoe's launch surfaces and work one lane at a time"
        accentColor="yellow"
        rightLabel={`${HOME_TABS.findIndex((tab) => tab.value === activeTab) + 1}/${HOME_TABS.length}`}
      >
        <Box gap={2} flexWrap="wrap">
          {HOME_TABS.map((tab) => (
            <Box key={tab.value} gap={1}>
              <Text color={tab.value === activeTab ? "yellow" : "gray"}>
                {tab.value === activeTab ? "▸" : " "}
              </Text>
              <Text color={tab.value === activeTab ? "cyan" : "gray"} bold={tab.value === activeTab || (tab.value === activeTab && focusArea === "tabs")}>
                {tab.label}
              </Text>
            </Box>
          ))}
        </Box>
      </Panel>

      {activeTab === "dispatch" && (
        <Panel
          title="Dispatch Board"
          subtitle={pendingDispatchTarget ? "Opening the selected workflow now..." : "Choose the workflow Roscoe should enter next"}
          accentColor="yellow"
          rightLabel={pendingDispatchTarget ? "opening" : undefined}
        >
          <Box flexDirection="column">
            {dispatchItems.map((item, index) => {
              const selected = focusArea === "dispatch" && index === dispatchIndex;
              return (
                <Box key={item.value} gap={1}>
                  <Text color={selected ? "cyan" : "gray"}>{selected ? "›" : " "}</Text>
                  <Text color={selected ? "cyan" : "white"} bold={selected}>
                    {item.label}
                  </Text>
                </Box>
              );
            })}
            {pendingDispatchTarget && (
              <Box marginTop={1}>
                <Text dimColor>
                  {pendingDispatchTarget === "session-setup"
                    ? "Opening lane setup..."
                    : "Opening onboarding..."}
                </Text>
              </Box>
            )}
          </Box>
        </Panel>
      )}

      {activeTab === "providers" && providerDiscoveryStatus !== "ready" && (
        <Panel
          title="Provider Setup"
          subtitle="Installed CLIs, new-lane availability, and provider-specific startup features"
          accentColor="cyan"
          rightLabel="scanning"
        >
          <Spinner label="Scanning installed providers..." />
          <Text dimColor>
            Roscoe scans provider CLI help and MCP preflight in the background after startup so this panel is usually ready by the time you open it.
          </Text>
        </Panel>
      )}

      {activeTab === "providers" && providerDiscoveryStatus === "ready" && !activeProvider && (
        <Panel
          title="Provider Setup"
          subtitle="Installed CLIs, new-lane availability, and provider-specific startup features"
          accentColor="cyan"
          rightLabel="none detected"
        >
          <Text dimColor>No supported providers were detected on this machine.</Text>
        </Panel>
      )}

      {activeTab === "providers" && providerDiscoveryStatus === "ready" && activeProvider && (
        <Panel
          title="Provider Setup"
          subtitle="Installed CLIs, new-lane availability, and provider-specific startup features"
          accentColor="cyan"
          rightLabel={roscoeSettings.providers[activeProvider.id].enabled ? "enabled" : "hidden"}
        >
          <Box gap={1} flexWrap="wrap">
            {discoveredProviders.map((provider, index) => {
              const selected = provider.id === activeProvider.id;
              const enabled = roscoeSettings.providers[provider.id].enabled;
              const label = provider.label;
              return (
                <Box key={provider.id} gap={1}>
                  <Text color={selected && focusArea === "provider-tabs" ? "yellow" : "gray"}>
                    {selected ? "▸" : " "}
                  </Text>
                  <Text color={selected ? "cyan" : "gray"} bold={selected || (enabled && index === providerTabIndex)}>
                    {label}
                  </Text>
                </Box>
              );
            })}
          </Box>

          <Box marginTop={1} gap={1} flexWrap="wrap">
            <Pill label={activeProvider.installed ? "installed" : "missing"} color={activeProvider.installed ? "green" : "red"} />
            <Pill
              label={roscoeSettings.providers[activeProvider.id].enabled ? "enabled for new lanes" : "hidden from new lanes"}
              color={roscoeSettings.providers[activeProvider.id].enabled ? "green" : "yellow"}
            />
            <Pill label={activeProvider.command} color="cyan" />
            <Pill label={activeProvider.preflight.headlessReady ? "headless ready" : "headless blocked"} color={activeProvider.preflight.headlessReady ? "green" : "red"} />
            <Pill label={activeProvider.preflight.mcpListReady ? "mcp ready" : "mcp unavailable"} color={activeProvider.preflight.mcpListReady ? "green" : "red"} />
            <Pill
              label={describeMcpServerCount(activeProvider.preflight.mcpServers.length)}
              color={activeProvider.preflight.mcpServers.length > 0 ? "green" : "yellow"}
            />
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{activeProvider.path ? `Binary: ${activeProvider.path}` : `${activeProvider.label} is not installed on this machine.`}</Text>
            <Text dimColor>
              Preflight checks whether Roscoe can use this provider headlessly, whether <Text color="cyan">mcp list</Text> succeeds, and which MCP servers this CLI instance reports locally. Roscoe does not install or manage MCP servers here.
            </Text>
            {activeProvider.preflight.mcpServers.length > 0 ? (
              <Text dimColor>
                <Text color="cyan">MCP servers:</Text>
                {" "}
                {activeProvider.preflight.mcpServers.join(", ")}
              </Text>
            ) : (
              <Text dimColor>
                <Text color="cyan">MCP servers:</Text>
                {" none detected"}
              </Text>
            )}
            {activeProvider.preflight.note ? (
              <Text dimColor>{activeProvider.preflight.note}</Text>
            ) : null}
            {activeProvider.id === "gemini" && (
              <Text dimColor>Gemini lanes use <Text color="cyan">--output-format stream-json</Text>, <Text color="cyan">--resume</Text>, and Roscoe's normal safe/accelerated execution mapping.</Text>
            )}
            {activeProvider.id === "qwen" && (
              <Text dimColor>Qwen lanes use <Text color="cyan">--output-format stream-json</Text> with <Text color="cyan">--include-partial-messages</Text>. Roscoe maps safe mode to <Text color="cyan">--sandbox</Text>, accelerated mode drops sandbox, and turns run with <Text color="cyan">--approval-mode yolo</Text>.</Text>
            )}
            {activeProvider.id === "kimi" && (
              <Text dimColor>Kimi lanes use <Text color="cyan">--print --output-format stream-json</Text>. Roscoe maps safe mode to <Text color="cyan">--plan</Text> and accelerated mode to normal print execution, while reasoning maps to Kimi's thinking toggles.</Text>
            )}
          </Box>

          {providerActions.length > 0 ? (
            <Box marginTop={1} flexDirection="column">
              {providerActions.map((action, index) => {
                const selected = focusArea === "provider-actions" && index === providerActionIndex;
                return (
                  <Box key={action.key} flexDirection="column" marginBottom={1}>
                    <Box gap={1}>
                      <Text color={selected ? "cyan" : "gray"}>{selected ? "›" : " "}</Text>
                      <Text color={selected ? "yellow" : "white"} bold={selected}>{action.label}</Text>
                      <Text dimColor>{action.value}</Text>
                    </Box>
                    <Box marginLeft={2}>
                      <Text dimColor>{action.description}</Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor>No Roscoe-managed startup toggles are available for this provider yet.</Text>
            </Box>
          )}

          {providerMessage && (
            <Box marginTop={1}>
              <Text color={providerMessage.color}>{providerMessage.text}</Text>
            </Box>
          )}
        </Panel>
      )}

      {activeTab === "roscoe" && (
        <Panel
          title="Roscoe Settings"
          subtitle="Core Roscoe behavior toggles that apply across all projects and lanes"
          accentColor="yellow"
          rightLabel={[
            roscoeSettings.behavior.autoHealMetadata ? "auto-heal on" : "auto-heal off",
            roscoeSettings.behavior.parkAtMilestonesForReview ? "milestone park on" : "milestone park off",
            roscoeSettings.behavior.preventSleepWhileRunning ? "awake on" : "awake off",
          ].join(" · ")}
        >
          <Box flexDirection="column">
            {roscoeActions.map((action, index) => {
              const selected = focusArea === "roscoe-actions" && index === roscoeActionIndex;
              return (
                <Box key={action.key} flexDirection="column" marginBottom={1}>
                  <Box gap={1}>
                    <Text color={selected ? "cyan" : "gray"}>{selected ? "›" : " "}</Text>
                    <Text color={selected ? "yellow" : "white"} bold={selected}>{action.label}</Text>
                    <Text dimColor>{action.value}</Text>
                  </Box>
                  <Box marginLeft={2}>
                    <Text dimColor>{action.description}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Scope: metadata/session healing only. Roscoe may reinterpret stale saved lane state during startup restore so it can reopen work instead of resuming dead native sessions.</Text>
            <Text dimColor>Milestone parking is <Text color="cyan">off</Text> by default. Leave it off if you want Roscoe and Guild to keep planning the next slice until the app is truly complete or blocked.</Text>
            <Text dimColor>Keep-awake uses native OS helpers so the computer does not go to sleep while Roscoe is running: <Text color="cyan">caffeinate</Text> on macOS and <Text color="cyan">SetThreadExecutionState</Text> on Windows.</Text>
            <Text dimColor>Not included: Roscoe does not patch its own source code here. Future self-patching or hot-reload ideas stay experimental and documented separately for now.</Text>
            {roscoeMessage && <Text color={roscoeMessage.color}>{roscoeMessage.text}</Text>}
          </Box>
        </Panel>
      )}

      {activeTab === "channel" && (
        <Panel
          title="Channel Setup"
          subtitle="Choose whether Roscoe channels run through roscoe.sh or through your own local provider credentials"
          accentColor="magenta"
          rightLabel={channelRoute === "roscoe-hosted" ? "roscoe-hosted" : channelRoute === "self-hosted" ? "self-hosted" : "route not chosen"}
        >
          <Box gap={1} flexWrap="wrap">
            <Pill label="sms" color="magenta" />
            <Pill label="webhook" color="cyan" />
            <Pill label={channelRoute === "roscoe-hosted" ? "roscoe-hosted" : channelRoute === "self-hosted" ? "self-hosted" : "route not chosen"} color={channelRoute === "unconfigured" ? "yellow" : "green"} />
            {channelRoute === "self-hosted" ? (
              <>
                <Pill label={notificationStatus.enabled ? "sms on" : "sms off"} color={notificationStatus.enabled ? "green" : "yellow"} />
                <Pill label={notificationStatus.providerReady ? "provider ready" : "env missing"} color={notificationStatus.providerReady ? "green" : "red"} />
                <Pill label={roscoeSettings.notifications.consentAcknowledged ? "consent acknowledged" : "consent pending"} color={roscoeSettings.notifications.consentAcknowledged ? "green" : "yellow"} />
              </>
            ) : null}
            {channelRoute === "roscoe-hosted" ? (
              <>
                <Pill
                  label={hostedRelayLinked ? "bidirectional ready" : hostedTestVerified ? "reply C to confirm" : "round trip pending"}
                  color={hostedRelayLinked ? "green" : "yellow"}
                />
                <Pill label={hostedStatus?.active ? "subscription active" : hostedStatus?.subscriptionStatus ?? "subscription inactive"} color={hostedStatus?.active ? "green" : "yellow"} />
              </>
            ) : null}
          </Box>

          {pendingConsentPhone ? (
            <Box marginTop={1}>
              <Panel
                title="SMS Consent"
                subtitle="Review this notice before Roscoe saves the phone number"
                accentColor="yellow"
              >
                <Text dimColor>By accepting, you consent to receive text messages from Roscoe at <Text color="cyan">{pendingConsentPhone}</Text>.</Text>
                <Text dimColor>Message and data rates may apply. Reply STOP to unsubscribe.</Text>
                <Text dimColor>
                  More info:
                  {" "}
                  <Text color="cyan">https://roscoe.sh/sms-consent</Text>
                </Text>
                <Text dimColor>Accepting will save this phone number and mark SMS consent as acknowledged. Cancel will clear the phone number and leave SMS unsaved.</Text>
                <Box marginTop={1} gap={2}>
                  <Box gap={1}>
                    <Text color={consentDialogIndex === 0 ? "cyan" : "gray"}>{consentDialogIndex === 0 ? "▸" : " "}</Text>
                    <Text color={consentDialogIndex === 0 ? "yellow" : "white"} bold={consentDialogIndex === 0}>Accept</Text>
                  </Box>
                  <Box gap={1}>
                    <Text color={consentDialogIndex === 1 ? "cyan" : "gray"}>{consentDialogIndex === 1 ? "▸" : " "}</Text>
                    <Text color={consentDialogIndex === 1 ? "yellow" : "white"} bold={consentDialogIndex === 1}>Cancel</Text>
                  </Box>
                </Box>
              </Panel>
            </Box>
          ) : null}

          <Box marginTop={1} flexDirection="column" gap={1}>
            {editingChannelField ? (
              <Box flexDirection="column" gap={1}>
                <Text color="yellow" bold>Phone Number</Text>
                <TextInput
                  defaultValue={wireDraft}
                  placeholder="+15551234567"
                  onChange={setWireDraft}
                  onSubmit={(value) => {
                    const cleaned = cleanPhoneNumber(value);
                    if (!cleaned) {
                      saveRoscoeSettings({
                        ...roscoeSettings,
                        notifications: {
                          ...roscoeSettings.notifications,
                          phoneNumber: "",
                          enabled: false,
                          consentAcknowledged: false,
                          hostedTestVerifiedPhone: "",
                          hostedRelayAccessToken: "",
                          hostedRelayAccessTokenExpiresAt: "",
                          hostedRelayRefreshToken: "",
                          hostedRelayLinkedPhone: "",
                          hostedRelayLinkedEmail: "",
                        },
                      });
                      setEditingChannelField(null);
                      setPendingConsentSnapshot(null);
                      setWireDraft("");
                      setWireRevision((current) => current + 1);
                      setWireMessage({
                        text: "Phone number cleared.",
                        color: "yellow",
                      });
                      return;
                    }

                    saveRoscoeSettings({
                      ...roscoeSettings,
                      notifications: {
                        ...roscoeSettings.notifications,
                        phoneNumber: "",
                        enabled: false,
                        consentAcknowledged: false,
                        hostedTestVerifiedPhone: "",
                        hostedRelayAccessToken: "",
                        hostedRelayAccessTokenExpiresAt: "",
                        hostedRelayRefreshToken: "",
                        hostedRelayLinkedPhone: "",
                        hostedRelayLinkedEmail: "",
                      },
                    });
                    setEditingChannelField(null);
                    setPendingConsentSnapshot({
                      hostedTestVerifiedPhone: roscoeSettings.notifications.hostedTestVerifiedPhone,
                      hostedRelayAccessToken: roscoeSettings.notifications.hostedRelayAccessToken,
                      hostedRelayAccessTokenExpiresAt: roscoeSettings.notifications.hostedRelayAccessTokenExpiresAt,
                      hostedRelayRefreshToken: roscoeSettings.notifications.hostedRelayRefreshToken,
                      hostedRelayLinkedPhone: roscoeSettings.notifications.hostedRelayLinkedPhone,
                      hostedRelayLinkedEmail: roscoeSettings.notifications.hostedRelayLinkedEmail,
                    });
                    setPendingConsentPhone(cleaned);
                    setConsentDialogIndex(0);
                    setWireDraft(cleaned);
                    setWireRevision((current) => current + 1);
                    setWireMessage(null);
                  }}
                />
                <Text dimColor>Enter continues to SMS consent. Esc cancels. Use E.164 style like +15551234567.</Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                {channelActions.map((action, index) => {
                  const selected = focusArea === "channel-actions" && index === channelActionIndex;
                  return (
                    <Box key={action.key} flexDirection="column" marginBottom={1}>
                      <Box gap={1}>
                        <Text color={selected ? "cyan" : "gray"}>{selected ? "›" : " "}</Text>
                        <Text color={selected ? "yellow" : "white"} bold={selected}>{action.label}</Text>
                        <Text dimColor>{action.value}</Text>
                      </Box>
                      <Box marginLeft={2}>
                        <Text dimColor>{action.description}</Text>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            {channelRoute === "unconfigured" ? (
              <>
                <Text dimColor>First choose whether Roscoe channels should run through roscoe.sh or through your own local provider credentials.</Text>
                <Text dimColor>Roscoe-hosted keeps Twilio and webhook ingress on roscoe.sh. Self-hosted keeps those credentials in your active project's <Text color="cyan">.env.local</Text>.</Text>
              </>
            ) : channelRoute === "self-hosted" ? (
              <>
                <Text dimColor>{notificationStatus.summary}</Text>
                <Text dimColor>Put local provider credentials in the active project's <Text color="cyan">.env.local</Text>. Roscoe already loads that file at startup and copies it into worktrees when needed.</Text>
                <Text dimColor>Set <Text color="cyan">TWILIO_ACCOUNT_SID</Text>, <Text color="cyan">TWILIO_AUTH_TOKEN</Text>, and either <Text color="cyan">TWILIO_FROM_NUMBER</Text> or <Text color="cyan">TWILIO_MESSAGING_SERVICE_SID</Text>.</Text>
                <Text dimColor>{notificationStatus.inboundDetail}</Text>
              </>
            ) : (
              <>
                <Text dimColor>Roscoe-hosted uses roscoe.sh for inbound SMS and webhook delivery so your local machine does not need a public tunnel or local Twilio credentials.</Text>
                <Text dimColor>Save your phone number, send yourself a hosted test SMS, and reply C when it arrives so you can verify the round trip back into this CLI.</Text>
                <Text dimColor>Checkout can open immediately once the phone number is saved, so billing no longer waits on the hosted test SMS.</Text>
                {hostedStatus?.recordUpdatedAt ? <Text dimColor>Latest relay billing update: {hostedStatus.recordUpdatedAt}</Text> : null}
              </>
            )}
            <Text dimColor>
              <Text color="cyan">Coming soon:</Text>
              {" Slack, Discord, Telegram, WhatsApp"}
            </Text>
            {wireMessage && <Text color={wireMessage.color}>{wireMessage.text}</Text>}
          </Box>
        </Panel>
      )}

    </Box>
  );
}

function formatLaneLabel(session: Pick<SessionState, "projectName" | "worktreeName">): string {
  return session.worktreeName === "main"
    ? `${session.projectName}:main`
    : `${session.projectName}:${session.worktreeName}`;
}
