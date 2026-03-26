import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
}));

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import {
  loadProfile,
  listProfiles,
  loadProjectContext,
  registerProject,
  listRegisteredProjects,
  loadAuthProfile,
  listAuthProfiles,
  saveProjectHistory,
  listProjectHistory,
  loadRoscoeSettings,
  saveRoscoeSettings,
  saveLaneSession,
  loadLaneSession,
  listLaneSessions,
} from "./config.js";

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  describe("loadProfile", () => {
    it("reads and parses profile JSON", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ name: "claude-code", command: "claude", args: ["--verbose"] }),
      );
      const profile = loadProfile("claude-code");
      expect(profile.name).toBe("claude-code");
      expect(profile.command).toBe("claude");
      expect(profile.args).toEqual(["--verbose"]);
    });

    it("throws on invalid JSON", () => {
      vi.mocked(readFileSync).mockReturnValue("not json");
      expect(() => loadProfile("bad")).toThrow();
    });
  });

  describe("listProfiles", () => {
    it("returns profile names without .json extension", () => {
      vi.mocked(readdirSync).mockReturnValue(["claude-code.json", "codex.json", "readme.md"] as any);
      const profiles = listProfiles();
      expect(profiles).toEqual(["claude-code", "codex"]);
    });

    it("returns empty array when no profiles", () => {
      vi.mocked(readdirSync).mockReturnValue([] as any);
      expect(listProfiles()).toEqual([]);
    });
  });

  describe("loadAuthProfile", () => {
    it("reads and parses auth profile JSON", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ name: "github", url: "https://github.com", steps: [] }),
      );
      const profile = loadAuthProfile("github");
      expect(profile.name).toBe("github");
      expect(profile.url).toBe("https://github.com");
    });
  });

  describe("listAuthProfiles", () => {
    it("returns empty when auth dir does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(listAuthProfiles()).toEqual([]);
    });

    it("filters for .json files", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["github.json", "notes.txt"] as any);
      expect(listAuthProfiles()).toEqual(["github"]);
    });
  });

  describe("loadProjectContext", () => {
    it("returns parsed project context", () => {
      const ctx = { name: "proj", directory: "/tmp", goals: [], milestones: [], techStack: [], notes: "" };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(ctx));
      const result = loadProjectContext("/tmp/project");
      expect(result!.name).toBe("proj");
      expect(result!.intentBrief).toBeTruthy();
    });

    it("returns null when file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(loadProjectContext("/tmp/project")).toBeNull();
    });

    it("falls back to legacy .llm-responder memory when .roscoe is missing", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("/tmp/project/.roscoe/project.json")) return false;
        if (filePath.includes("/tmp/project/.llm-responder/project.json")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "legacy-proj",
        directory: "/tmp/project",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result!.name).toBe("legacy-proj");
    });

    it("normalizes interview answers and intent fields", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: ["Ship"],
        milestones: ["v1"],
        techStack: ["TypeScript"],
        notes: "Keep it tight",
        interviewAnswers: [{ question: "Who is this for?", answer: "Operators", theme: "users" }],
        intentBrief: {
          projectStory: "Give operators a fast console",
          definitionOfDone: ["main flow complete"],
          acceptanceChecks: ["demo flow completes cleanly"],
          deliveryPillars: {
            frontend: ["Operator UI completes the main workflow"],
            backend: ["API persists the workflow state correctly"],
            unitComponentTests: ["Vitest coverage reaches 100% on frontend/backend logic and edge cases"],
            e2eTests: ["Playwright coverage reaches 100% on the full workflow and failure modes"],
          },
          coverageMechanism: ["Vitest + Playwright coverage reports provide a measurable percent gate"],
        },
      }));
      const result = loadProjectContext("/tmp/project");
      expect(result!.interviewAnswers).toEqual([
        { question: "Who is this for?", answer: "Operators", theme: "users" },
      ]);
      expect(result!.intentBrief!.projectStory).toContain("operators");
      expect(result!.intentBrief!.definitionOfDone).toEqual(["main flow complete"]);
      expect(result!.intentBrief!.acceptanceChecks).toEqual(["demo flow completes cleanly"]);
      expect(result!.intentBrief!.deliveryPillars.frontend[0]).toContain("Operator UI");
      expect(result!.intentBrief!.coverageMechanism[0]).toContain("measurable percent");
      expect(result!.intentBrief!.successSignals).toEqual(["v1"]);
    });

    it("keeps structured multi-select interview answers", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        interviewAnswers: [
          {
            question: "Which constraints apply?",
            answer: "Kubernetes | Vercel AI SDK",
            theme: "constraints",
            mode: "multi",
            selectedOptions: ["Kubernetes", "Vercel AI SDK"],
            freeText: "Keep the provider lock in place.",
          },
        ],
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result!.interviewAnswers).toEqual([
        {
          question: "Which constraints apply?",
          answer: "Kubernetes | Vercel AI SDK",
          theme: "constraints",
          mode: "multi",
          selectedOptions: ["Kubernetes", "Vercel AI SDK"],
          freeText: "Keep the provider lock in place.",
        },
      ]);
    });
  });

  describe("registerProject", () => {
    it("adds new project to registry", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ projects: [] }));
      registerProject("myproj", "/tmp/myproj");
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("myproj"),
      );
    });

    it("updates existing project by directory", () => {
      const existing = {
        projects: [
          { name: "old-name", directory: "/tmp/myproj", onboardedAt: "2024-01-01", lastActive: "2024-01-01" },
        ],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(existing));
      registerProject("new-name", "/tmp/myproj");
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
      expect(written.projects).toHaveLength(1);
      expect(written.projects[0].name).toBe("new-name");
    });

    it("creates registry dir if it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error("no file"); });
      registerProject("proj", "/tmp");
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });
  });

  describe("lane sessions", () => {
    it("writes lane session snapshots under the project memory directory", () => {
      saveLaneSession({
        laneKey: "unused",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: "thread-1",
        trackerHistory: [{ role: "assistant", content: "hello", timestamp: 1 }],
        timeline: [],
        outputLines: ["hello"],
        summary: "summary",
        currentToolUse: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/sessions.json"),
        expect.stringContaining("\"providerSessionId\": \"thread-1\""),
      );
    });

    it("loads a saved lane session by lane identity", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            trackerHistory: [{ role: "assistant", content: "hello", timestamp: 1 }],
            timeline: [],
            outputLines: ["hello"],
            summary: "summary",
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.providerSessionId).toBe("thread-1");
      expect(record?.trackerHistory[0]?.content).toBe("hello");
    });

    it("lists legacy lane sessions from .llm-responder when needed", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("/tmp/proj/.roscoe/sessions.json")) return false;
        if (filePath.includes("/tmp/proj/.llm-responder/sessions.json")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "legacy",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "claude-code",
            protocol: "claude",
            providerSessionId: "sess-9",
            trackerHistory: [],
            timeline: [],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const sessions = listLaneSessions("/tmp/proj");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].providerSessionId).toBe("sess-9");
    });
  });

  describe("listRegisteredProjects", () => {
    it("returns projects from registry", () => {
      const registry = {
        projects: [
          { name: "proj1", directory: "/tmp/a", onboardedAt: "2024-01-01", lastActive: "2024-01-01" },
        ],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(registry));
      const projects = listRegisteredProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("proj1");
    });

    it("returns empty array when no registry file", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(listRegisteredProjects()).toEqual([]);
    });

    it("filters ephemeral e2e projects and sorts by lastActive", () => {
      const registry = {
        projects: [
          { name: "intent", directory: "/var/folders/x/roscoe-onboard-e2e-abc/project", onboardedAt: "2024-01-01", lastActive: "2024-01-03" },
          { name: "real-a", directory: "/tmp/a", onboardedAt: "2024-01-01", lastActive: "2024-01-02" },
          { name: "real-b", directory: "/tmp/b", onboardedAt: "2024-01-01", lastActive: "2024-01-04" },
        ],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(registry));
      const projects = listRegisteredProjects();
      expect(projects.map((project) => project.name)).toEqual(["real-b", "real-a"]);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.stringContaining("roscoe-onboard-e2e"),
      );
    });
  });

  describe("project history", () => {
    it("writes timestamped history files under the project history directory", () => {
      saveProjectHistory({
        id: "2026-03-25T12-00-00-onboard",
        mode: "onboard",
        createdAt: "2026-03-25T12:00:00.000Z",
        directory: "/tmp/proj",
        projectName: "proj",
        runtime: {
          profileName: "codex",
          protocol: "codex",
          summary: "codex · gpt-5.4 · xhigh",
          settings: { model: "gpt-5.4", reasoningEffort: "xhigh" },
        },
        rawTranscript: "raw turn transcript",
        questions: [
          {
            question: "Which constraints apply?",
            options: ["A", "B"],
            selectionMode: "multi",
          },
        ],
        answers: [
          {
            question: "Which constraints apply?",
            answer: "A | B",
            mode: "multi",
            selectedOptions: ["A", "B"],
          },
        ],
        briefSnapshot: {
          name: "proj",
          directory: "/tmp/proj",
          goals: [],
          milestones: [],
          techStack: [],
          notes: "",
        },
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/history/2026-03-25T12-00-00-onboard.json"),
        expect.stringContaining("\"rawTranscript\": \"raw turn transcript\""),
      );
    });

    it("loads history records from disk", () => {
      vi.mocked(readdirSync).mockReturnValue(["2026-03-25T12-00-00-onboard.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "2026-03-25T12-00-00-onboard",
        mode: "onboard",
        createdAt: "2026-03-25T12:00:00.000Z",
        directory: "/tmp/proj",
        projectName: "proj",
        runtime: {
          profileName: "codex",
          protocol: "codex",
          summary: "codex · gpt-5.4 · xhigh",
          settings: { model: "gpt-5.4", reasoningEffort: "xhigh" },
        },
        rawTranscript: "raw turn transcript",
        questions: [{ question: "q", options: ["A"], selectionMode: "single" }],
        answers: [{ question: "q", answer: "A", mode: "single", selectedOptions: ["A"] }],
        briefSnapshot: {
          name: "proj",
          directory: "/tmp/proj",
          goals: [],
          milestones: [],
          techStack: [],
          notes: "",
        },
      }));

      const history = listProjectHistory("/tmp/proj");
      expect(history).toHaveLength(1);
      expect(history[0].answers[0]).toMatchObject({
        mode: "single",
        selectedOptions: ["A"],
      });
      expect(history[0].questions[0].selectionMode).toBe("single");
    });
  });

  describe("roscoe settings", () => {
    it("returns defaults when no settings file exists", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(loadRoscoeSettings()).toEqual({
        notifications: {
          enabled: false,
          phoneNumber: "",
          provider: "twilio",
        },
      });
    });

    it("falls back to legacy settings path", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.endsWith("/.roscoe/settings.json")) return false;
        if (filePath.endsWith("/.llm-responder/settings.json")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          provider: "twilio",
        },
      }));

      expect(loadRoscoeSettings().notifications).toMatchObject({
        enabled: true,
        phoneNumber: "+15551234567",
        provider: "twilio",
      });
    });

    it("writes settings under .roscoe", () => {
      saveRoscoeSettings({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          provider: "twilio",
        },
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/.roscoe/settings.json"),
        expect.stringContaining("+15551234567"),
      );
    });
  });
});
