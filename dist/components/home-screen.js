import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { useAppContext } from "../app.js";
import { listProjectHistory, listRegisteredProjects, loadProjectContext, loadRoscoeSettings, saveRoscoeSettings, } from "../config.js";
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
];
const CHANNEL_TABS = [
    { label: "Phone", value: "phone" },
];
let hasShownRoscoeIntro = false;
export function resetHomeScreenIntroForTests() {
    hasShownRoscoeIntro = false;
}
function abbreviatePath(path, max = 72) {
    if (path.length <= max)
        return path;
    const head = path.slice(0, Math.max(16, Math.floor(max * 0.45)));
    const tail = path.slice(-Math.max(20, Math.floor(max * 0.35)));
    return `${head}...${tail}`;
}
export function HomeScreen() {
    const { dispatch } = useAppContext();
    const notifier = useMemo(() => new NotificationService(), []);
    const projects = listRegisteredProjects();
    const [showIntro, setShowIntro] = useState(() => !hasShownRoscoeIntro);
    const [briefProjectDir, setBriefProjectDir] = useState(null);
    const [activeTab, setActiveTab] = useState("dispatch");
    const [focusArea, setFocusArea] = useState("tabs");
    const [dispatchIndex, setDispatchIndex] = useState(0);
    const [channelTabIndex, setChannelTabIndex] = useState(0);
    const [channelActionIndex, setChannelActionIndex] = useState(0);
    const [memoryIndex, setMemoryIndex] = useState(0);
    const [wireRevision, setWireRevision] = useState(0);
    const [editingPhone, setEditingPhone] = useState(false);
    const [wireDraft, setWireDraft] = useState(() => loadRoscoeSettings().notifications.phoneNumber);
    const [wireMessage, setWireMessage] = useState(null);
    const [wireBusy, setWireBusy] = useState(false);
    const visibleProjects = projects.slice(0, 6);
    const hiddenProjects = Math.max(0, projects.length - visibleProjects.length);
    const roscoeSettings = useMemo(() => loadRoscoeSettings(), [wireRevision]);
    const notificationStatus = useMemo(() => notifier.getStatus(), [notifier, wireRevision]);
    const briefContext = useMemo(() => briefProjectDir ? loadProjectContext(briefProjectDir) : null, [briefProjectDir]);
    const briefHistory = useMemo(() => briefProjectDir ? listProjectHistory(briefProjectDir) : [], [briefProjectDir]);
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
    const selectHomeTab = (tab) => {
        setActiveTab(tab);
        setFocusArea("tabs");
    };
    const handleSelect = (value) => {
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
        if (wireBusy)
            return;
        setWireBusy(true);
        setWireMessage({ text: "Sending Roscoe test wire...", color: "yellow" });
        notifier.sendTestMessage()
            .then((result) => {
            setWireMessage({
                text: result.detail,
                color: result.ok ? (result.delivered ? "green" : "yellow") : "red",
            });
        })
            .catch((error) => {
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
        if (showIntro)
            return;
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
        if (briefProjectDir)
            return;
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
                }
                else if (activeTab === "channel") {
                    setFocusArea("channel-tabs");
                }
                else if (projects.length > 0) {
                    setFocusArea("memory");
                }
                return;
            }
        }
        if (activeTab === "dispatch" && focusArea === "dispatch") {
            if (key.upArrow) {
                if (dispatchIndex === 0) {
                    setFocusArea("tabs");
                }
                else {
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
                }
                else {
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
                }
                else {
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
        return _jsx(RoscoeIntro, { onDone: handleIntroDone });
    }
    if (briefContext) {
        return (_jsx(Box, { flexDirection: "column", padding: 1, children: _jsx(ProjectBriefView, { context: briefContext, history: briefHistory, actionItems: [
                    { label: "Start Sessions for this project", value: "start" },
                    { label: "Refine Understanding", value: "refine" },
                    { label: "Back", value: "back" },
                ], onAction: (value) => {
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
                }, title: "Project Brief", subtitle: "Saved Roscoe understanding for this remembered project" }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", padding: 1, gap: 1, children: [_jsxs(Panel, { title: "ROSCOE DISPATCH", subtitle: "Roscoe at the desk. Guild workers in the field.", accentColor: "cyan", rightLabel: `${projects.length} remembered`, children: [_jsx(Text, { bold: true, children: "Track Claude and Codex sessions, judge the next wire, and keep every Guild lane aligned with the brief." }), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: activeHints }) })] }), _jsx(Panel, { title: "Home Tabs", subtitle: "Arrow across Roscoe's launch surfaces and work one lane at a time", accentColor: "yellow", rightLabel: `${HOME_TABS.findIndex((tab) => tab.value === activeTab) + 1}/${HOME_TABS.length}`, children: _jsx(Box, { gap: 2, flexWrap: "wrap", children: HOME_TABS.map((tab) => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: tab.value === activeTab ? "yellow" : "gray", children: tab.value === activeTab ? "▸" : " " }), _jsx(Text, { color: tab.value === activeTab ? "cyan" : "gray", bold: tab.value === activeTab || (tab.value === activeTab && focusArea === "tabs"), children: tab.label })] }, tab.value))) }) }), activeTab === "dispatch" && (_jsx(Panel, { title: "Dispatch Board", subtitle: "Choose the workflow Roscoe should enter next", accentColor: "yellow", children: _jsx(Box, { flexDirection: "column", children: items.map((item, index) => {
                        const selected = focusArea === "dispatch" && index === dispatchIndex;
                        return (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: selected ? "cyan" : "gray", children: selected ? "›" : " " }), _jsx(Text, { color: selected ? "cyan" : "white", bold: selected, children: item.label })] }, item.value));
                    }) }) })), activeTab === "channel" && (_jsxs(Panel, { title: "Channel Setup", subtitle: "Optional SMS progress updates from Roscoe", accentColor: "magenta", rightLabel: notificationStatus.enabled ? "armed" : "idle", children: [_jsxs(Box, { gap: 1, flexWrap: "wrap", children: [_jsx(Pill, { label: "twilio sms", color: "magenta" }), _jsx(Pill, { label: notificationStatus.enabled ? "sms on" : "sms off", color: notificationStatus.enabled ? "green" : "yellow" }), _jsx(Pill, { label: notificationStatus.providerReady ? "provider ready" : "env missing", color: notificationStatus.providerReady ? "green" : "red" }), _jsx(Pill, { label: notificationStatus.inboundMode === "webhook" ? "webhook inbound" : "poll inbound", color: notificationStatus.inboundMode === "webhook" ? "cyan" : "yellow" })] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", gap: 1, children: [_jsx(Box, { gap: 2, children: CHANNEL_TABS.map((tab, index) => {
                                    const selected = index === channelTabIndex;
                                    const focused = selected && focusArea === "channel-tabs";
                                    return (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: focused ? "yellow" : "gray", children: selected ? "▸" : " " }), _jsx(Text, { color: selected ? "yellow" : "gray", bold: selected, children: tab.label })] }, tab.value));
                                }) }), activeChannelTab === "phone" && (_jsx(Box, { flexDirection: "column", children: editingPhone ? (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { color: "yellow", bold: true, children: "Phone Number" }), _jsx(TextInput, { defaultValue: wireDraft, placeholder: "+15551234567", onChange: setWireDraft, onSubmit: (value) => {
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
                                            } }), _jsx(Text, { dimColor: true, children: "Enter saves. Esc cancels. Use E.164 style like +15551234567." })] })) : (_jsx(Box, { flexDirection: "column", children: channelActions.map((action, index) => {
                                        const selected = focusArea === "channel-actions" && index === channelActionIndex;
                                        return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: selected ? "cyan" : "gray", children: selected ? "›" : " " }), _jsx(Text, { color: selected ? "yellow" : "white", bold: selected, children: action.label }), _jsx(Text, { dimColor: true, children: action.value })] }), _jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: action.description }) })] }, action.key));
                                    }) })) }))] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: notificationStatus.summary }), _jsx(Text, { dimColor: true, children: "Roscoe texts milestone summaries with percent-complete estimates and evidence URLs when they show up in the transcript." }), _jsx(Text, { dimColor: true, children: "Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`." }), _jsx(Text, { dimColor: true, children: notificationStatus.inboundDetail }), wireMessage && _jsx(Text, { color: wireMessage.color, children: wireMessage.text })] })] })), activeTab === "memory" && (_jsx(Panel, { title: "Project Memory", subtitle: "Onboarded codebases, intent briefs, and recently active directories", rightLabel: projects.length === 0 ? "empty" : `${visibleProjects.length} shown`, children: projects.length === 0 ? (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { dimColor: true, children: "No projects onboarded yet." }), _jsx(Text, { dimColor: true, children: "Run onboarding once so Roscoe can keep the project story, definition of done, and guardrails close at hand." })] })) : (_jsxs(Box, { flexDirection: "column", gap: 1, children: [visibleProjects.map((p, index) => (_jsxs(Box, { flexDirection: "column", children: [index > 0 && _jsx(Divider, {}), _jsxs(Box, { flexDirection: "column", gap: 0, children: [_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: focusArea === "memory" && index === memoryIndex ? "cyan" : "gray", children: focusArea === "memory" && index === memoryIndex ? "›" : " " }), _jsx(Text, { color: focusArea === "memory" && index === memoryIndex ? "cyan" : "white", bold: focusArea === "memory" && index === memoryIndex, children: p.name }), _jsx(Pill, { label: p.lastActive.slice(0, 10), color: "yellow" })] }), _jsx(Text, { dimColor: true, children: abbreviatePath(p.directory.replace(process.env.HOME ?? "", "~")) })] })] }, p.directory))), hiddenProjects > 0 && (_jsxs(_Fragment, { children: [_jsx(Divider, {}), _jsxs(Text, { dimColor: true, children: [hiddenProjects, " more remembered projects offstage."] })] })), _jsx(Text, { dimColor: true, children: "Arrow down into the list, then press Enter to open a saved project brief." })] })) }))] }));
}
