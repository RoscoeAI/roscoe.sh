import { useState, useRef, useCallback } from "react";
import { Onboarder } from "../onboarder.js";
import {
  InterviewSelectionMode,
  OnboardingMode,
  ProjectContext,
  ProjectRuntimeDefaults,
  loadProjectContext,
  listProjectHistory,
} from "../config.js";
import { detectProtocol, getProviderAdapter, HeadlessProfile } from "../llm-runtime.js";
import { cleanSecretBlocks, parseSecretRequestBlock, ProjectSecretRequest } from "../project-secrets.js";

export type OnboardingStatus = "idle" | "initializing" | "running" | "interviewing" | "complete" | "error";

export const SKIP_OPTION = "Skip — use your best judgment and check in on critical decisions";

export interface QAPair {
  question: string;
  answer: string;
  theme?: string;
}

export interface InterviewQuestion {
  text: string;
  options: string[];
  theme?: string;
  purpose?: string;
  selectionMode: InterviewSelectionMode;
}

export interface AnswerSubmission {
  text: string;
  mode?: InterviewSelectionMode;
  selectedOptions?: string[];
  freeText?: string;
}

export interface OnboardingState {
  status: OnboardingStatus;
  streamingText: string;
  thinkingText: string;
  qaHistory: QAPair[];
  question: InterviewQuestion | null;
  secretRequest: ProjectSecretRequest | null;
  error: string | null;
  projectContext: ProjectContext | null;
  toolActivity: string | null;
}

export function parseSecretRequest(text: string): ProjectSecretRequest | null {
  return parseSecretRequestBlock(text);
}

/** Parse structured question block from Claude's response */
export function parseQuestion(text: string): InterviewQuestion | null {
  const match = text.match(/---QUESTION---\s*\n?([\s\S]*?)\n?---END_QUESTION---/);
  if (!match) return null;
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
  } catch {
    return null;
  }
  return null;
}

/** Remove structured blocks from display text */
export function cleanStreamingText(text: string): string {
  return cleanSecretBlocks(
    text
      .replace(/---QUESTION---[\s\S]*?---END_QUESTION---/g, "")
      .replace(/---BRIEF---[\s\S]*?---END_BRIEF---/g, ""),
  ).trim();
}

export function appendStreamingChunk(previous: string, chunk: string): string {
  if (!previous) return chunk;
  if (!chunk) return previous;
  if (/\s$/.test(previous) || /^\s/.test(chunk)) return previous + chunk;
  if (/[.!?]["')\]]?$/.test(previous) && /^[A-Z]/.test(chunk)) {
    return `${previous} ${chunk}`;
  }
  return previous + chunk;
}

export function formatOnboardingExitError(profile: HeadlessProfile | undefined, code: number): string {
  const provider = profile ? detectProtocol(profile) : "claude";
  return `${getProviderAdapter(provider).label} exited with code ${code}`;
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>({
    status: "idle",
    streamingText: "",
    thinkingText: "",
    qaHistory: [],
    question: null,
    secretRequest: null,
    error: null,
    projectContext: null,
    toolActivity: null,
  });

  const onboarderRef = useRef<Onboarder | null>(null);

  const start = useCallback((
    dir: string,
    debug = false,
    profile?: HeadlessProfile,
    runtimeDefaults?: ProjectRuntimeDefaults,
    mode: OnboardingMode = "onboard",
    refineThemes: string[] = [],
  ) => {
    const resolvedProfile = profile;
    const onboarder = new Onboarder(
      dir,
      debug,
      profile,
      runtimeDefaults,
      {
        mode,
        refineThemes,
        seedContext: mode === "refine" ? loadProjectContext(dir) : null,
        seedHistory: mode === "refine" ? listProjectHistory(dir) : [],
      },
    );
    onboarderRef.current = onboarder;

    setState((prev) => ({
      ...prev,
      status: "initializing",
      streamingText: "",
      thinkingText: "",
      qaHistory: [],
      question: null,
      secretRequest: null,
      error: null,
    }));

    let fullText = "";
    let thinkingText = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

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

    onboarder.on("output", (data: string) => {
      fullText = appendStreamingChunk(fullText, data);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 80);
      }
    });

    onboarder.on("thinking", (data: string) => {
      thinkingText = appendStreamingChunk(thinkingText, data);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 80);
      }
    });

    onboarder.on("tool-activity", (toolName: string) => {
      setState((prev) => ({
        ...prev,
        status: prev.status === "initializing" ? "running" : prev.status,
        toolActivity: toolName,
      }));
    });

    onboarder.on("turn-complete", () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

      const question = parseQuestion(fullText);
      const secretRequest = parseSecretRequest(fullText);
      const cleaned = cleanStreamingText(fullText);

      setState((prev) => ({
        ...prev,
        status: "interviewing",
        streamingText: cleaned,
        thinkingText: "",
        question: secretRequest ? null : question,
        secretRequest,
        toolActivity: null,
      }));

      fullText = "";
      thinkingText = "";
    });

    onboarder.on("onboarding-complete", (context: ProjectContext) => {
      setState((prev) => ({
        ...prev,
        status: "complete",
        secretRequest: null,
        projectContext: context,
      }));
    });

    onboarder.on("continue-interview", (report: { missingThemes: string[]; missingFields: string[] }) => {
      const details = [
        report.missingThemes.length > 0 ? `Missing themes: ${report.missingThemes.join(", ")}` : "",
        report.missingFields.length > 0 ? `Still underspecified: ${report.missingFields.join(", ")}` : "",
      ].filter(Boolean).join(" · ");

      setState((prev) => ({
        ...prev,
        status: "running",
        question: null,
        secretRequest: null,
        toolActivity: null,
        streamingText: details
          ? `Roscoe is tightening the intent brief before finishing. ${details}`
          : "Roscoe is tightening the intent brief before finishing.",
        thinkingText: "",
      }));
    });

    onboarder.on("exit", (code: number) => {
      setState((prev) => {
        if (prev.status === "complete" || prev.status === "interviewing") return prev;
        return {
          ...prev,
          status: code === 0 ? "complete" : "error",
          error: code !== 0 ? formatOnboardingExitError(resolvedProfile, code) : null,
        };
      });
    });

    onboarder.start();
  }, []);

  const sendInput = useCallback((submission: string | AnswerSubmission) => {
    const payload = typeof submission === "string"
      ? { text: submission }
      : submission;

    setState((prev) => {
      const qa: QAPair = {
        question: prev.question?.text ?? "",
        answer: payload.text,
        ...(prev.question?.theme ? { theme: prev.question.theme } : {}),
      };
      onboarderRef.current?.sendInput(
        payload.text,
        prev.question
          ? {
              question: prev.question.text,
              theme: prev.question.theme,
              purpose: prev.question.purpose,
              options: prev.question.options,
              selectionMode: prev.question.selectionMode,
            }
          : undefined,
        {
          ...(payload.mode ? { mode: payload.mode } : {}),
          ...(payload.selectedOptions?.length ? { selectedOptions: payload.selectedOptions } : {}),
          ...(payload.freeText ? { freeText: payload.freeText } : {}),
        },
      );
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

  const sendSecretInput = useCallback((request: ProjectSecretRequest, secretValue: string) => {
    const trimmed = secretValue.trim();
    if (!trimmed) return;

    setState((prev) => {
      onboarderRef.current?.sendSecretInput(request, "provided", trimmed);
      return {
        ...prev,
        status: "running",
        question: null,
        secretRequest: null,
        toolActivity: null,
        streamingText: "",
        thinkingText: "",
        qaHistory: [
          ...prev.qaHistory,
          {
            question: `Secure secret: ${request.label}`,
            answer: `[provided securely in ${request.targetFile}]`,
            theme: `secret:${request.key}`,
          },
        ],
      };
    });
  }, []);

  const skipSecretInput = useCallback((request: ProjectSecretRequest) => {
    setState((prev) => {
      onboarderRef.current?.sendSecretInput(request, "skipped");
      return {
        ...prev,
        status: "running",
        question: null,
        secretRequest: null,
        toolActivity: null,
        streamingText: "",
        thinkingText: "",
        qaHistory: [
          ...prev.qaHistory,
          {
            question: `Secure secret: ${request.label}`,
            answer: "[skipped for now]",
            theme: `secret:${request.key}`,
          },
        ],
      };
    });
  }, []);

  const updateRuntime = useCallback((
    profile: HeadlessProfile,
    runtimeDefaults?: ProjectRuntimeDefaults,
  ) => {
    onboarderRef.current?.updateRuntime(profile, runtimeDefaults);
  }, []);

  return { state, start, sendInput, sendSecretInput, skipSecretInput, updateRuntime };
}
