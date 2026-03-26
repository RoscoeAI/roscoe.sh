import { useState, useRef, useCallback } from "react";
import { Onboarder } from "../onboarder.js";
import { loadProjectContext, listProjectHistory, } from "../config.js";
import { detectProtocol } from "../llm-runtime.js";
export const SKIP_OPTION = "Skip — use your best judgment and check in on critical decisions";
/** Parse structured question block from Claude's response */
export function parseQuestion(text) {
    const match = text.match(/---QUESTION---\s*\n?([\s\S]*?)\n?---END_QUESTION---/);
    if (!match)
        return null;
    try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.question && Array.isArray(parsed.options)) {
            return {
                text: parsed.question,
                options: parsed.options,
                ...(typeof parsed.theme === "string" ? { theme: parsed.theme } : {}),
                ...(typeof parsed.purpose === "string" ? { purpose: parsed.purpose } : {}),
                selectionMode: parsed.selectionMode === "multi" ? "multi" : "single",
            };
        }
    }
    catch {
        return null;
    }
    return null;
}
/** Remove structured blocks from display text */
export function cleanStreamingText(text) {
    return text
        .replace(/---QUESTION---[\s\S]*?---END_QUESTION---/g, "")
        .replace(/---BRIEF---[\s\S]*?---END_BRIEF---/g, "")
        .trim();
}
export function appendStreamingChunk(previous, chunk) {
    if (!previous)
        return chunk;
    if (!chunk)
        return previous;
    if (/\s$/.test(previous) || /^\s/.test(chunk))
        return previous + chunk;
    if (/[.!?]["')\]]?$/.test(previous) && /^[A-Z]/.test(chunk)) {
        return `${previous} ${chunk}`;
    }
    return previous + chunk;
}
export function formatOnboardingExitError(profile, code) {
    const provider = profile ? detectProtocol(profile) : "claude";
    return `${provider === "codex" ? "Codex" : "Claude"} exited with code ${code}`;
}
export function useOnboarding() {
    const [state, setState] = useState({
        status: "idle",
        streamingText: "",
        thinkingText: "",
        qaHistory: [],
        question: null,
        error: null,
        projectContext: null,
        toolActivity: null,
    });
    const onboarderRef = useRef(null);
    const start = useCallback((dir, debug = false, profile, runtimeDefaults, mode = "onboard", refineThemes = []) => {
        const resolvedProfile = profile;
        const onboarder = new Onboarder(dir, debug, profile, runtimeDefaults, {
            mode,
            refineThemes,
            seedContext: mode === "refine" ? loadProjectContext(dir) : null,
            seedHistory: mode === "refine" ? listProjectHistory(dir) : [],
        });
        onboarderRef.current = onboarder;
        setState((prev) => ({
            ...prev,
            status: "initializing",
            streamingText: "",
            thinkingText: "",
            qaHistory: [],
            question: null,
            error: null,
        }));
        let fullText = "";
        let thinkingText = "";
        let flushTimer = null;
        const flush = () => {
            const cleaned = cleanStreamingText(fullText);
            setState((prev) => ({
                ...prev,
                status: prev.status === "initializing" ? "running" : prev.status,
                streamingText: cleaned,
                thinkingText,
            }));
            flushTimer = null;
        };
        onboarder.on("output", (data) => {
            fullText = appendStreamingChunk(fullText, data);
            if (!flushTimer) {
                flushTimer = setTimeout(flush, 80);
            }
        });
        onboarder.on("thinking", (data) => {
            thinkingText = appendStreamingChunk(thinkingText, data);
            if (!flushTimer) {
                flushTimer = setTimeout(flush, 80);
            }
        });
        onboarder.on("tool-activity", (toolName) => {
            setState((prev) => ({
                ...prev,
                status: prev.status === "initializing" ? "running" : prev.status,
                toolActivity: toolName,
            }));
        });
        onboarder.on("turn-complete", () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            const question = parseQuestion(fullText);
            const cleaned = cleanStreamingText(fullText);
            setState((prev) => ({
                ...prev,
                status: "interviewing",
                streamingText: cleaned,
                thinkingText: "",
                question,
                toolActivity: null,
            }));
            fullText = "";
            thinkingText = "";
        });
        onboarder.on("onboarding-complete", (context) => {
            setState((prev) => ({
                ...prev,
                status: "complete",
                projectContext: context,
            }));
        });
        onboarder.on("continue-interview", (report) => {
            const details = [
                report.missingThemes.length > 0 ? `Missing themes: ${report.missingThemes.join(", ")}` : "",
                report.missingFields.length > 0 ? `Still underspecified: ${report.missingFields.join(", ")}` : "",
            ].filter(Boolean).join(" · ");
            setState((prev) => ({
                ...prev,
                status: "running",
                question: null,
                toolActivity: null,
                streamingText: details
                    ? `Roscoe is tightening the intent brief before finishing. ${details}`
                    : "Roscoe is tightening the intent brief before finishing.",
                thinkingText: "",
            }));
        });
        onboarder.on("exit", (code) => {
            setState((prev) => {
                if (prev.status === "complete" || prev.status === "interviewing")
                    return prev;
                return {
                    ...prev,
                    status: code === 0 ? "complete" : "error",
                    error: code !== 0 ? formatOnboardingExitError(resolvedProfile, code) : null,
                };
            });
        });
        onboarder.start();
    }, []);
    const sendInput = useCallback((submission) => {
        const payload = typeof submission === "string"
            ? { text: submission }
            : submission;
        setState((prev) => {
            const qa = {
                question: prev.question?.text ?? "",
                answer: payload.text,
                ...(prev.question?.theme ? { theme: prev.question.theme } : {}),
            };
            onboarderRef.current?.sendInput(payload.text, prev.question
                ? {
                    question: prev.question.text,
                    theme: prev.question.theme,
                    purpose: prev.question.purpose,
                    options: prev.question.options,
                    selectionMode: prev.question.selectionMode,
                }
                : undefined, {
                ...(payload.mode ? { mode: payload.mode } : {}),
                ...(payload.selectedOptions?.length ? { selectedOptions: payload.selectedOptions } : {}),
                ...(payload.freeText ? { freeText: payload.freeText } : {}),
            });
            return {
                ...prev,
                status: "running",
                question: null,
                toolActivity: null,
                streamingText: "",
                thinkingText: "",
                qaHistory: [...prev.qaHistory, qa],
            };
        });
    }, []);
    const updateRuntime = useCallback((profile, runtimeDefaults) => {
        onboarderRef.current?.updateRuntime(profile, runtimeDefaults);
    }, []);
    return { state, start, sendInput, updateRuntime };
}
