import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { useAppContext } from "../app.js";
import {
  listProjectHistory,
  listRegisteredProjects,
  loadProjectContext,
  loadRoscoeSettings,
  saveRoscoeSettings,
} from "../config.js";
import { Divider, KeyHints, Panel, Pill } from "./chrome.js";
import { RoscoeIntro } from "./roscoe-intro.js";
import { ProjectBriefView } from "./project-brief.js";
import { cleanPhoneNumber, NotificationService } from "../notification-service.js";

const items = [
  { label: "Start Sessions — configure and launch monitoring", value: "session-setup" },
  { label: "Onboard Project — analyze codebase and generate docs", value: "onboarding" },
  { label: "Exit", value: "exit" },
];

const HOME_TABS = [
  { label: "Dispatch Board", value: "dispatch" },
  { label: "Channel Setup", value: "channel" },
  { label: "Project Memory", value: "memory" },
] as const;

const CHANNEL_TABS = [
  { label: "Phone", value: "phone" },
] as const;

type HomeTab = typeof HOME_TABS[number]["value"];
type FocusArea = "tabs" | "dispatch" | "channel-tabs" | "channel-actions" | "memory";

let hasShownRoscoeIntro = false;

export function resetHomeScreenIntroForTests(): void {
  hasShownRoscoeIntro = false;
}

function abbreviatePath(path: string, max = 72): string {
  if (path.length <= max) return path;
  const head = path.slice(0, Math.max(16, Math.floor(max * 0.45)));
  const tail = path.slice(-Math.max(20, Math.floor(max * 0.35)));
  return `${head}...${tail}`;
}

export function HomeScreen() {
  const { dispatch } = useAppContext();
  const notifier = useMemo(() => new NotificationService(), []);
  const projects = listRegisteredProjects();
  const [showIntro, setShowIntro] = useState(() => !hasShownRoscoeIntro);
  const [briefProjectDir, setBriefProjectDir] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HomeTab>("dispatch");
  const [focusArea, setFocusArea] = useState<FocusArea>("tabs");
  const [dispatchIndex, setDispatchIndex] = useState(0);
  const [channelTabIndex, setChannelTabIndex] = useState(0);
  const [channelActionIndex, setChannelActionIndex] = useState(0);
  const [memoryIndex, setMemoryIndex] = useState(0);
  const [wireRevision, setWireRevision] = useState(0);
  const [editingPhone, setEditingPhone] = useState(false);
  const [wireDraft, setWireDraft] = useState(() => loadRoscoeSettings().notifications.phoneNumber);
  const [wireMessage, setWireMessage] = useState<{ text: string; color: "green" | "red" | "yellow" } | null>(null);
  const [wireBusy, setWireBusy] = useState(false);
  const visibleProjects = projects.slice(0, 6);
  const hiddenProjects = Math.max(0, projects.length - visibleProjects.length);
  const roscoeSettings = useMemo(
    () => loadRoscoeSettings(),
    [wireRevision],
  );
  const notificationStatus = useMemo(
    () => notifier.getStatus(),
    [notifier, wireRevision],
  );
  const briefContext = useMemo(
    () => briefProjectDir ? loadProjectContext(briefProjectDir) : null,
    [briefProjectDir],
  );
  const briefHistory = useMemo(
    () => briefProjectDir ? listProjectHistory(briefProjectDir) : [],
    [briefProjectDir],
  );
  const activeChannelTab = CHANNEL_TABS[channelTabIndex]?.value ?? "phone";
  const channelActions = useMemo(() => ([
    {
      key: "phone",
      label: "Phone Number",
      value: notificationStatus.phoneNumber || "No phone saved yet.",
      description: "Press Enter to add or edit the destination number.",
    },
    {
      key: "sms",
      label: "SMS Updates",
      value: notificationStatus.enabled ? "Armed" : "Paused",
      description: "Press Enter to toggle milestone texts on or off.",
    },
    {
      key: "test",
      label: "Send Test SMS",
      value: wireBusy ? "Sending..." : "Ready",
      description: "Press Enter to send a Roscoe test wire now.",
    },
  ]), [notificationStatus.enabled, notificationStatus.phoneNumber, wireBusy]);

  const handleIntroDone = () => {
    hasShownRoscoeIntro = true;
    setShowIntro(false);
  };

  const selectHomeTab = (tab: HomeTab) => {
    setActiveTab(tab);
    setFocusArea("tabs");
  };

  const handleSelect = (value: string) => {
    switch (value) {
      case "session-setup":
        dispatch({ type: "OPEN_SESSION_SETUP" });
        break;
      case "onboarding":
        dispatch({ type: "OPEN_ONBOARDING", request: { mode: "onboard" } });
        break;
      case "exit":
        process.exit(0);
    }
  };

  const toggleSmsUpdates = () => {
    const nextEnabled = !roscoeSettings.notifications.enabled;
    if (nextEnabled && !cleanPhoneNumber(roscoeSettings.notifications.phoneNumber)) {
      setWireMessage({ text: "Add a phone number before arming SMS updates.", color: "yellow" });
      return;
    }
    saveRoscoeSettings({
      notifications: {
        ...roscoeSettings.notifications,
        enabled: nextEnabled,
      },
    });
    setWireRevision((value) => value + 1);
    setWireMessage({
      text: nextEnabled ? "Roscoe will text milestone updates." : "Roscoe SMS updates paused.",
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

  const activeHints = useMemo(() => {
    if (editingPhone) {
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
      ];
    }

    if (activeTab === "channel" && focusArea === "channel-tabs") {
      return [
        { keyLabel: "←/→", description: "switch channel" },
        { keyLabel: "↓", description: "choose action" },
        { keyLabel: "↑", description: "back to tabs" },
      ];
    }

    if (activeTab === "channel" && focusArea === "channel-actions") {
      return [
        { keyLabel: "↑/↓", description: "move action" },
        { keyLabel: "Enter", description: "activate" },
        { keyLabel: "←/→", description: "channel tabs" },
      ];
    }

    return [
      { keyLabel: "↑/↓", description: "move selection" },
      { keyLabel: "Enter", description: "open project brief" },
    ];
  }, [activeTab, editingPhone, focusArea]);

  useInput((input, key) => {
    const isEnter = key.return || input === "\r" || input === "\n";

    if (showIntro) return;
    if (editingPhone) {
      if (key.escape) {
        setEditingPhone(false);
        setWireDraft(roscoeSettings.notifications.phoneNumber);
        setWireMessage(null);
      }
      return;
    }
    if (briefProjectDir && key.escape) {
      setBriefProjectDir(null);
      return;
    }
    if (briefProjectDir) return;

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
        } else if (activeTab === "channel") {
          setFocusArea("channel-tabs");
        } else if (projects.length > 0) {
          setFocusArea("memory");
        }
        return;
      }
    }

    if (activeTab === "dispatch" && focusArea === "dispatch") {
      if (key.upArrow) {
        if (dispatchIndex === 0) {
          setFocusArea("tabs");
        } else {
          setDispatchIndex((value) => Math.max(0, value - 1));
        }
        return;
      }

      if (key.downArrow) {
        setDispatchIndex((value) => Math.min(items.length - 1, value + 1));
        return;
      }

      if (isEnter) {
        handleSelect(items[dispatchIndex].value);
        return;
      }
    }

    if (activeTab === "channel" && focusArea === "channel-tabs") {
      if (key.upArrow) {
        setFocusArea("tabs");
        return;
      }

      if (key.leftArrow || (key.shift && key.tab)) {
        setChannelTabIndex((value) => (value <= 0 ? CHANNEL_TABS.length - 1 : value - 1));
        return;
      }

      if (key.rightArrow || key.tab) {
        setChannelTabIndex((value) => (value >= CHANNEL_TABS.length - 1 ? 0 : value + 1));
        return;
      }

      if (key.downArrow || isEnter) {
        setFocusArea("channel-actions");
        return;
      }
    }

    if (activeTab === "channel" && focusArea === "channel-actions") {
      if (key.upArrow) {
        if (channelActionIndex === 0) {
          setFocusArea("channel-tabs");
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
        setFocusArea("channel-tabs");
        return;
      }

      if (isEnter) {
        const action = channelActions[channelActionIndex]?.key;
        if (action === "phone") {
          setEditingPhone(true);
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
        }
        return;
      }
    }

    if (activeTab === "memory" && focusArea === "memory") {
      if (key.upArrow) {
        if (memoryIndex === 0) {
          setFocusArea("tabs");
        } else {
          setMemoryIndex((value) => Math.max(0, value - 1));
        }
        return;
      }

      if (key.downArrow) {
        setMemoryIndex((value) => Math.min(Math.max(visibleProjects.length - 1, 0), value + 1));
        return;
      }

      if (isEnter) {
        const project = visibleProjects[memoryIndex];
        if (project) {
          setBriefProjectDir(project.directory);
        }
        return;
      }
    }
  });

  if (showIntro) {
    return <RoscoeIntro onDone={handleIntroDone} />;
  }

  if (briefContext) {
    return (
      <Box flexDirection="column" padding={1}>
        <ProjectBriefView
          context={briefContext}
          history={briefHistory}
          actionItems={[
            { label: "Start Sessions for this project", value: "start" },
            { label: "Refine Understanding", value: "refine" },
            { label: "Back", value: "back" },
          ]}
          onAction={(value) => {
            if (value === "start") {
              dispatch({ type: "OPEN_SESSION_SETUP", projectDir: briefContext.directory });
              return;
            }
            if (value === "refine") {
              dispatch({
                type: "OPEN_ONBOARDING",
                request: {
                  dir: briefContext.directory,
                  initialProfileName: briefContext.runtimeDefaults?.onboarding?.profileName,
                  initialRuntimeOverrides: briefContext.runtimeDefaults?.onboarding?.runtime,
                  mode: "refine",
                },
              });
              return;
            }
            setBriefProjectDir(null);
          }}
          title="Project Brief"
          subtitle="Saved Roscoe understanding for this remembered project"
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Panel
        title="ROSCOE DISPATCH"
        subtitle="Roscoe at the desk. Guild workers in the field."
        accentColor="cyan"
        rightLabel={`${projects.length} remembered`}
      >
        <Text bold>Track Claude and Codex sessions, judge the next wire, and keep every Guild lane aligned with the brief.</Text>
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
          subtitle="Choose the workflow Roscoe should enter next"
          accentColor="yellow"
        >
          <Box flexDirection="column">
            {items.map((item, index) => {
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
          </Box>
        </Panel>
      )}

      {activeTab === "channel" && (
        <Panel
          title="Channel Setup"
          subtitle="Optional SMS progress updates from Roscoe"
          accentColor="magenta"
          rightLabel={notificationStatus.enabled ? "armed" : "idle"}
        >
          <Box gap={1} flexWrap="wrap">
            <Pill label="twilio sms" color="magenta" />
            <Pill label={notificationStatus.enabled ? "sms on" : "sms off"} color={notificationStatus.enabled ? "green" : "yellow"} />
            <Pill label={notificationStatus.providerReady ? "provider ready" : "env missing"} color={notificationStatus.providerReady ? "green" : "red"} />
            <Pill
              label={notificationStatus.inboundMode === "webhook" ? "webhook inbound" : "poll inbound"}
              color={notificationStatus.inboundMode === "webhook" ? "cyan" : "yellow"}
            />
          </Box>

          <Box marginTop={1} flexDirection="column" gap={1}>
            <Box gap={2}>
              {CHANNEL_TABS.map((tab, index) => {
                const selected = index === channelTabIndex;
                const focused = selected && focusArea === "channel-tabs";
                return (
                  <Box key={tab.value} gap={1}>
                    <Text color={focused ? "yellow" : "gray"}>{selected ? "▸" : " "}</Text>
                    <Text color={selected ? "yellow" : "gray"} bold={selected}>
                      {tab.label}
                    </Text>
                  </Box>
                );
              })}
            </Box>

            {activeChannelTab === "phone" && (
              <Box flexDirection="column">
                {editingPhone ? (
                  <Box flexDirection="column" gap={1}>
                    <Text color="yellow" bold>Phone Number</Text>
                    <TextInput
                      defaultValue={wireDraft}
                      placeholder="+15551234567"
                      onChange={setWireDraft}
                      onSubmit={(value) => {
                        const cleaned = cleanPhoneNumber(value);
                        saveRoscoeSettings({
                          notifications: {
                            ...roscoeSettings.notifications,
                            phoneNumber: cleaned,
                            enabled: cleaned ? roscoeSettings.notifications.enabled : false,
                          },
                        });
                        setEditingPhone(false);
                        setWireDraft(cleaned);
                        setWireRevision((current) => current + 1);
                        setWireMessage({
                          text: cleaned ? `Saved ${cleaned}.` : "Phone number cleared.",
                          color: cleaned ? "green" : "yellow",
                        });
                      }}
                    />
                    <Text dimColor>Enter saves. Esc cancels. Use E.164 style like +15551234567.</Text>
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
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{notificationStatus.summary}</Text>
            <Text dimColor>Roscoe texts milestone summaries with percent-complete estimates and evidence URLs when they show up in the transcript.</Text>
            <Text dimColor>Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.</Text>
            <Text dimColor>{notificationStatus.inboundDetail}</Text>
            {wireMessage && <Text color={wireMessage.color}>{wireMessage.text}</Text>}
          </Box>
        </Panel>
      )}

      {activeTab === "memory" && (
        <Panel
          title="Project Memory"
          subtitle="Onboarded codebases, intent briefs, and recently active directories"
          rightLabel={projects.length === 0 ? "empty" : `${visibleProjects.length} shown`}
        >
          {projects.length === 0 ? (
            <Box flexDirection="column" gap={1}>
              <Text dimColor>No projects onboarded yet.</Text>
              <Text dimColor>Run onboarding once so Roscoe can keep the project story, definition of done, and guardrails close at hand.</Text>
            </Box>
          ) : (
            <Box flexDirection="column" gap={1}>
              {visibleProjects.map((p, index) => (
                <Box key={p.directory} flexDirection="column">
                  {index > 0 && <Divider />}
                  <Box flexDirection="column" gap={0}>
                    <Box gap={1}>
                      <Text color={focusArea === "memory" && index === memoryIndex ? "cyan" : "gray"}>
                        {focusArea === "memory" && index === memoryIndex ? "›" : " "}
                      </Text>
                      <Text color={focusArea === "memory" && index === memoryIndex ? "cyan" : "white"} bold={focusArea === "memory" && index === memoryIndex}>{p.name}</Text>
                      <Pill label={p.lastActive.slice(0, 10)} color="yellow" />
                    </Box>
                    <Text dimColor>{abbreviatePath(p.directory.replace(process.env.HOME ?? "", "~"))}</Text>
                  </Box>
                </Box>
              ))}
              {hiddenProjects > 0 && (
                <>
                  <Divider />
                  <Text dimColor>{hiddenProjects} more remembered projects offstage.</Text>
                </>
              )}
              <Text dimColor>Arrow down into the list, then press Enter to open a saved project brief.</Text>
            </Box>
          )}
        </Panel>
      )}
    </Box>
  );
}
