import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, measureElement } from "ink";
import { stripAnsi, wrapBlock, wrapLine } from "../text-layout.js";
import { Panel, Pill } from "./chrome.js";
import { summarizeRuntime } from "../llm-runtime.js";
import { getRuntimeTuningMode } from "../runtime-defaults.js";
function formatGuildLabel(session) {
    const lane = session.worktreeName === "main" ? session.projectName : session.worktreeName;
    return `GUILD ${lane.toUpperCase()}`;
}
function confidenceColor(confidence) {
    if (typeof confidence !== "number")
        return "gray";
    if (confidence >= 80)
        return "green";
    if (confidence >= 60)
        return "yellow";
    return "red";
}
function deliveryColor(delivery) {
    if (delivery === "auto" || delivery === "approved")
        return "green";
    if (delivery === "edited")
        return "yellow";
    if (delivery === "manual")
        return "magenta";
    return "gray";
}
function addWrappedLines(target, idPrefix, text, width, options = {}, indent = "", maxLines) {
    const wrapped = wrapBlock(text, width, indent);
    const visible = typeof maxLines === "number"
        ? wrapped.slice(0, maxLines)
        : wrapped;
    const overflowed = typeof maxLines === "number" && wrapped.length > maxLines;
    visible.forEach((line, idx) => {
        target.push({
            id: `${idPrefix}-${idx}`,
            text: line,
            ...options,
        });
    });
    if (overflowed && visible.length > 0) {
        const last = target[target.length - 1];
        target[target.length - 1] = {
            ...last,
            text: `${last.text.slice(0, Math.max(0, last.text.length - 3))}...`,
        };
    }
}
function addSpacer(target, id) {
    target.push({ id, text: "" });
}
function buildTraceLines(session, width) {
    const lines = [];
    const guildLabel = formatGuildLabel(session);
    const workerRuntime = session.managed.profile
        ? summarizeRuntime(session.managed.profile)
        : "worker";
    const workerMode = getRuntimeTuningMode(session.managed.profile?.runtime);
    const workerCommand = session.managed.monitor?.getLastCommandPreview?.() ?? null;
    const workerPrompt = session.managed.monitor?.getLastPrompt?.() ?? null;
    const workerStrategy = session.managed.lastWorkerRuntimeStrategy;
    const workerRationale = session.managed.lastWorkerRuntimeRationale;
    const responderCommand = session.managed.lastResponderCommand;
    const responderPrompt = session.managed.lastResponderPrompt;
    const responderRuntime = session.managed.lastResponderRuntimeSummary;
    const responderStrategy = session.managed.lastResponderStrategy;
    const responderRationale = session.managed.lastResponderRationale;
    const responderMode = getRuntimeTuningMode(session.managed.profile?.runtime);
    lines.push({
        id: "trace-worker-label",
        text: `${guildLabel} CLI`,
        color: "yellow",
        bold: true,
    });
    addWrappedLines(lines, "trace-worker-provider", `Provider: locked to ${session.managed.profile?.protocol ?? session.profileName}`, width, { dimColor: true }, "  ", 1);
    addWrappedLines(lines, "trace-worker-runtime", `Runtime: ${workerRuntime}`, width, { dimColor: true }, "  ", 1);
    addWrappedLines(lines, "trace-worker-mode", `Management: ${workerMode}`, width, { dimColor: true }, "  ", 1);
    if (workerStrategy) {
        addWrappedLines(lines, "trace-worker-strategy", `Tuning: ${workerStrategy}`, width, { dimColor: true }, "  ", 1);
    }
    if (workerRationale) {
        addWrappedLines(lines, "trace-worker-rationale", `Why: ${workerRationale}`, width, { dimColor: true }, "  ", 2);
    }
    if (workerCommand) {
        addWrappedLines(lines, "trace-worker-command", `Command: ${workerCommand}`, width, { color: "cyan" }, "  ", 1);
    }
    if (workerPrompt) {
        addWrappedLines(lines, "trace-worker-prompt", `Prompt: ${workerPrompt}`, width, {}, "  ", 2);
    }
    else {
        addWrappedLines(lines, "trace-worker-idle", "Prompt: waiting for the first worker turn.", width, { dimColor: true }, "  ", 1);
    }
    addSpacer(lines, "trace-gap-1");
    lines.push({
        id: "trace-responder-label",
        text: "ROSCOE CLI",
        color: "magenta",
        bold: true,
    });
    addWrappedLines(lines, "trace-responder-provider", `Provider: locked to ${session.managed.profile?.protocol ?? session.profileName}`, width, { dimColor: true }, "  ", 1);
    if (responderRuntime) {
        addWrappedLines(lines, "trace-responder-runtime", `Runtime: ${responderRuntime}`, width, { dimColor: true }, "  ", 1);
    }
    else {
        addWrappedLines(lines, "trace-responder-runtime-idle", "Runtime: waiting for the first responder pass.", width, { dimColor: true }, "  ", 1);
    }
    addWrappedLines(lines, "trace-responder-mode", `Management: ${responderMode}`, width, { dimColor: true }, "  ", 1);
    if (responderStrategy) {
        addWrappedLines(lines, "trace-responder-strategy", `Tuning: ${responderStrategy}`, width, { dimColor: true }, "  ", 1);
    }
    if (responderRationale) {
        addWrappedLines(lines, "trace-responder-rationale", `Why: ${responderRationale}`, width, { dimColor: true }, "  ", 1);
    }
    if (responderCommand) {
        addWrappedLines(lines, "trace-responder-command", `Command: ${responderCommand}`, width, { color: "magenta" }, "  ", 1);
    }
    if (responderPrompt) {
        addWrappedLines(lines, "trace-responder-prompt", `Prompt: ${responderPrompt}`, width, {}, "  ", 2);
    }
    addSpacer(lines, "trace-gap-2");
    lines.push({
        id: "trace-divider",
        text: "TRANSCRIPT",
        color: "gray",
        bold: true,
    });
    return lines;
}
function buildTranscriptLines(entries, width, session) {
    const lines = [];
    const guildLabel = formatGuildLabel(session);
    for (const entry of entries) {
        if (entry.kind === "remote-turn") {
            lines.push({
                id: `${entry.id}-label`,
                text: `${guildLabel} [${entry.provider}]${entry.activity ? ` [${entry.activity}]` : ""}`,
                color: "cyan",
                bold: true,
            });
            if (entry.note) {
                addWrappedLines(lines, `${entry.id}-note`, `Activity: ${entry.note}`, width, { dimColor: true }, "  ");
            }
            addWrappedLines(lines, `${entry.id}-body`, entry.text, width, {}, "  ");
            addSpacer(lines, `${entry.id}-gap`);
            continue;
        }
        if (entry.kind === "local-suggestion") {
            lines.push({
                id: `${entry.id}-label`,
                text: `ROSCOE [${entry.confidence}/100] [${entry.state === "dismissed" ? "dismissed" : "draft"}]`,
                color: entry.state === "dismissed" ? "yellow" : confidenceColor(entry.confidence),
                bold: true,
            });
            addWrappedLines(lines, `${entry.id}-body`, entry.text, width, { dimColor: entry.state === "dismissed" }, "  ");
            if (entry.reasoning) {
                addWrappedLines(lines, `${entry.id}-why`, `Reasoning: ${entry.reasoning}`, width, { dimColor: true }, "  ");
            }
            addSpacer(lines, `${entry.id}-gap`);
            continue;
        }
        if (entry.kind === "local-sent") {
            lines.push({
                id: `${entry.id}-label`,
                text: `ROSCOE [${entry.delivery}]${typeof entry.confidence === "number" ? ` [${entry.confidence}/100]` : ""}`,
                color: deliveryColor(entry.delivery),
                bold: true,
            });
            addWrappedLines(lines, `${entry.id}-body`, entry.text, width, {}, "  ");
            if (entry.reasoning) {
                addWrappedLines(lines, `${entry.id}-why`, `Reasoning: ${entry.reasoning}`, width, { dimColor: true }, "  ");
            }
            addSpacer(lines, `${entry.id}-gap`);
            continue;
        }
        if (entry.kind === "tool-activity") {
            lines.push({
                id: `${entry.id}-tool`,
                text: `${guildLabel} ACTIVITY [${entry.provider}] ${entry.toolName}`,
                color: "yellow",
                dimColor: true,
            });
            addSpacer(lines, `${entry.id}-gap`);
            continue;
        }
        lines.push({
            id: `${entry.id}-error`,
            text: `ERROR ${entry.text}`,
            color: "red",
            bold: true,
        });
        addSpacer(lines, `${entry.id}-gap`);
    }
    return lines;
}
function buildRawLines(lines, width) {
    const output = [];
    lines.forEach((line, index) => {
        const clean = stripAnsi(line).replace(/\r/g, "").replace(/\t/g, "  ");
        const wrapped = clean.trim()
            ? wrapLine(clean, width)
            : [""];
        wrapped.forEach((wrappedLine, wrappedIndex) => {
            output.push({
                id: `raw-${index}-${wrappedIndex}`,
                text: wrappedLine,
            });
        });
    });
    return output;
}
export function SessionOutput({ session, sessionLabel }) {
    const contentRef = useRef(null);
    const [viewport, setViewport] = useState({ width: 80, height: 14 });
    useEffect(() => {
        if (!contentRef.current)
            return;
        const measured = measureElement(contentRef.current);
        if (measured.width > 0 && measured.height > 0) {
            setViewport((current) => {
                if (current.width === measured.width && current.height === measured.height) {
                    return current;
                }
                return {
                    width: measured.width,
                    height: measured.height,
                };
            });
        }
    });
    const title = sessionLabel ? `Session Transcript — ${sessionLabel}` : "Session Transcript";
    const contentWidth = Math.max(24, viewport.width - 1);
    const traceLines = useMemo(() => {
        if (!session || session.viewMode !== "transcript")
            return [];
        return buildTraceLines(session, contentWidth);
    }, [contentWidth, session]);
    const renderedLines = useMemo(() => {
        if (!session)
            return [];
        if (session.viewMode === "transcript") {
            return buildTranscriptLines(session.timeline, contentWidth, session);
        }
        return buildRawLines(session.outputLines, contentWidth);
    }, [contentWidth, session]);
    if (!session) {
        return (_jsx(Panel, { title: title, subtitle: "Bird's-eye session view", rightLabel: "idle", accentColor: "gray", flexGrow: 1, children: _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, italic: true, children: "Waiting for output..." }), _jsx(Text, { dimColor: true, children: "Remote and local turns will appear here once the active session starts working." })] }) }));
    }
    const viewportHeight = Math.max(8, viewport.height || 14);
    const maxOffset = Math.max(0, renderedLines.length - viewportHeight);
    const effectiveOffset = session.followLive
        ? 0
        : Math.min(session.scrollOffset, maxOffset);
    const start = Math.max(0, renderedLines.length - viewportHeight - effectiveOffset);
    const visibleLines = renderedLines.slice(start, start + viewportHeight);
    const hiddenAbove = start;
    const hiddenBelow = Math.max(0, renderedLines.length - (start + visibleLines.length));
    return (_jsxs(Panel, { title: title, subtitle: session.viewMode === "transcript" ? "Guild/Roscoe trace plus the live session transcript" : "Raw Guild worker output", rightLabel: session.followLive
            ? `${session.viewMode} · live · ${session.viewMode === "transcript" ? `${session.timeline.length} events` : `${session.outputLines.length} lines`}`
            : `${session.viewMode} · scrolled`, accentColor: session.viewMode === "transcript" ? "cyan" : "gray", flexGrow: 1, children: [traceLines.length > 0 && (_jsx(Box, { flexDirection: "column", marginBottom: 1, children: traceLines.map((line) => (_jsx(Text, { color: line.color, bold: line.bold, dimColor: line.dimColor, children: line.text || " " }, line.id))) })), _jsx(Box, { ref: contentRef, flexDirection: "column", flexGrow: 1, overflow: "hidden", children: visibleLines.length === 0 ? (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, italic: true, children: session.viewMode === "transcript" ? "No transcript events yet." : "No raw output yet." }), _jsx(Text, { dimColor: true, children: session.viewMode === "transcript"
                                ? "The next remote turn and local responder draft will appear here."
                                : "Switch back to transcript or wait for the worker to emit more output." })] })) : (visibleLines.map((line) => (_jsx(Text, { color: line.color, bold: line.bold, dimColor: line.dimColor, children: line.text || " " }, line.id)))) }), !session.followLive && (_jsxs(Box, { marginTop: 1, flexWrap: "wrap", gap: 1, children: [_jsx(Pill, { label: "scrolled", color: "yellow" }), hiddenAbove > 0 && _jsxs(Text, { dimColor: true, children: [hiddenAbove, " earlier"] }), hiddenBelow > 0 && _jsxs(Text, { dimColor: true, children: [hiddenBelow, " newer"] })] }))] }));
}
