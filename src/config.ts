import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { AuthProfile } from "./browser-agent.js";
import { HeadlessProfile, LLMProtocol, RuntimeControlSettings } from "./llm-runtime.js";

export interface LLMProfile extends HeadlessProfile {}
export type InterviewSelectionMode = "single" | "multi";
export type OnboardingMode = "onboard" | "refine";

export interface ProjectRuntimeDefaults {
  lockedProvider?: LLMProtocol;
  workerByProtocol?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
  onboarding?: {
    profileName: string;
    runtime: RuntimeControlSettings;
  };
}

export interface InterviewAnswer {
  question: string;
  answer: string;
  theme?: string;
  mode?: InterviewSelectionMode;
  selectedOptions?: string[];
  freeText?: string;
}

export interface InterviewQuestionRecord {
  question: string;
  options: string[];
  theme?: string;
  purpose?: string;
  selectionMode?: InterviewSelectionMode;
}

export interface DeliveryPillars {
  frontend: string[];
  backend: string[];
  unitComponentTests: string[];
  e2eTests: string[];
}

export interface IntentBrief {
  projectStory: string;
  primaryUsers: string[];
  definitionOfDone: string[];
  acceptanceChecks: string[];
  successSignals: string[];
  deliveryPillars: DeliveryPillars;
  coverageMechanism: string[];
  nonGoals: string[];
  constraints: string[];
  autonomyRules: string[];
  qualityBar: string[];
  riskBoundaries: string[];
  uiDirection: string;
}

export interface ProjectContext {
  name: string;
  directory: string;
  goals: string[];
  milestones: string[];
  techStack: string[];
  notes: string;
  intentBrief?: IntentBrief;
  interviewAnswers?: InterviewAnswer[];
  runtimeDefaults?: ProjectRuntimeDefaults;
}

export interface ProjectHistoryRecord {
  id: string;
  mode: OnboardingMode;
  createdAt: string;
  directory: string;
  projectName: string;
  runtime: {
    profileName: string;
    protocol: LLMProtocol;
    summary: string;
    settings: RuntimeControlSettings;
  };
  rawTranscript: string;
  questions: InterviewQuestionRecord[];
  answers: InterviewAnswer[];
  briefSnapshot: ProjectContext;
}

export interface ProjectRegistryEntry {
  name: string;
  directory: string;
  onboardedAt: string;
  lastActive: string;
}

export interface ProjectRegistry {
  projects: ProjectRegistryEntry[];
}

export interface SmsNotificationSettings {
  enabled: boolean;
  phoneNumber: string;
  provider: "twilio";
}

export interface RoscoeSettings {
  notifications: SmsNotificationSettings;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROFILES_DIR = join(__dirname, "..", "profiles");
const AUTH_PROFILES_DIR = join(PROFILES_DIR, "auth");
const ROSCOE_HOME_DIRNAME = ".roscoe";
const LEGACY_ROSCOE_HOME_DIRNAME = ".llm-responder";
export const ROSCOE_PROJECT_DIRNAME = ".roscoe";
export const LEGACY_ROSCOE_PROJECT_DIRNAME = ".llm-responder";

function resolveExistingPath(primaryPath: string, legacyPath: string): string | null {
  if (existsSync(primaryPath)) return primaryPath;
  if (existsSync(legacyPath)) return legacyPath;
  return null;
}

function getRegistryDir(): string {
  return join(process.env.HOME || homedir(), ROSCOE_HOME_DIRNAME);
}

function getLegacyRegistryDir(): string {
  return join(process.env.HOME || homedir(), LEGACY_ROSCOE_HOME_DIRNAME);
}

function getRegistryPath(): string {
  return join(getRegistryDir(), "projects.json");
}

function getLegacyRegistryPath(): string {
  return join(getLegacyRegistryDir(), "projects.json");
}

function getExistingRegistryPath(): string {
  return resolveExistingPath(getRegistryPath(), getLegacyRegistryPath()) ?? getRegistryPath();
}

function getSettingsPath(): string {
  return join(getRegistryDir(), "settings.json");
}

function getLegacySettingsPath(): string {
  return join(getLegacyRegistryDir(), "settings.json");
}

function getExistingSettingsPath(): string {
  return resolveExistingPath(getSettingsPath(), getLegacySettingsPath()) ?? getSettingsPath();
}

export function getProjectMemoryDir(projectDir: string): string {
  return join(projectDir, ROSCOE_PROJECT_DIRNAME);
}

export function getLegacyProjectMemoryDir(projectDir: string): string {
  return join(projectDir, LEGACY_ROSCOE_PROJECT_DIRNAME);
}

export function resolveProjectMemoryDir(projectDir: string): string {
  return resolveExistingPath(
    getProjectMemoryDir(projectDir),
    getLegacyProjectMemoryDir(projectDir),
  ) ?? getProjectMemoryDir(projectDir);
}

export function getProjectContextPath(projectDir: string): string {
  return join(getProjectMemoryDir(projectDir), "project.json");
}

function getLegacyProjectContextPath(projectDir: string): string {
  return join(getLegacyProjectMemoryDir(projectDir), "project.json");
}

function getExistingProjectContextPath(projectDir: string): string | null {
  return resolveExistingPath(
    getProjectContextPath(projectDir),
    getLegacyProjectContextPath(projectDir),
  );
}

export function getProjectHistoryDir(projectDir: string): string {
  return join(getProjectMemoryDir(projectDir), "history");
}

function getLegacyProjectHistoryDir(projectDir: string): string {
  return join(getLegacyProjectMemoryDir(projectDir), "history");
}

function getExistingProjectHistoryDir(projectDir: string): string | null {
  return resolveExistingPath(
    getProjectHistoryDir(projectDir),
    getLegacyProjectHistoryDir(projectDir),
  );
}

function isEphemeralE2eProject(directory: string): boolean {
  return /[/\\](?:roscoe|llm-responder)-[^/\\]*e2e-[^/\\]+[/\\]project$/.test(directory);
}

function sanitizeRegistryProjects(projects: ProjectRegistryEntry[]): ProjectRegistryEntry[] {
  const byDirectory = new Map<string, ProjectRegistryEntry>();

  for (const project of projects) {
    if (!project || typeof project.directory !== "string" || typeof project.name !== "string") continue;
    const directory = resolve(project.directory);
    if (isEphemeralE2eProject(directory)) continue;

    const normalized: ProjectRegistryEntry = {
      name: project.name.trim() || "project",
      directory,
      onboardedAt: typeof project.onboardedAt === "string" ? project.onboardedAt : "",
      lastActive: typeof project.lastActive === "string" ? project.lastActive : "",
    };

    const existing = byDirectory.get(directory);
    if (!existing || normalized.lastActive > existing.lastActive) {
      byDirectory.set(directory, normalized);
    }
  }

  return Array.from(byDirectory.values()).sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

export function loadProfile(name: string): LLMProfile {
  const filePath = join(PROFILES_DIR, `${name}.json`);
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as LLMProfile;
}

export function listProfiles(): string[] {
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export function loadAuthProfile(name: string): AuthProfile {
  const filePath = join(AUTH_PROFILES_DIR, `${name}.json`);
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as AuthProfile;
}

export function listAuthProfiles(): string[] {
  if (!existsSync(AUTH_PROFILES_DIR)) return [];
  return readdirSync(AUTH_PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export function loadProjectContext(projectDir: string): ProjectContext | null {
  const filePath = getExistingProjectContextPath(projectDir);
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return normalizeProjectContext(JSON.parse(raw) as Partial<ProjectContext>);
}

function normalizeSmsNotificationSettings(value: unknown): SmsNotificationSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: typed.enabled === true,
    phoneNumber: typeof typed.phoneNumber === "string" ? typed.phoneNumber : "",
    provider: "twilio",
  };
}

function normalizeRoscoeSettings(value: unknown): RoscoeSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    notifications: normalizeSmsNotificationSettings(typed.notifications),
  };
}

export function loadRoscoeSettings(): RoscoeSettings {
  const settingsPath = getExistingSettingsPath();
  if (!existsSync(settingsPath)) {
    return normalizeRoscoeSettings(null);
  }

  try {
    return normalizeRoscoeSettings(JSON.parse(readFileSync(settingsPath, "utf-8")));
  } catch {
    return normalizeRoscoeSettings(null);
  }
}

export function saveRoscoeSettings(settings: RoscoeSettings): void {
  const registryDir = getRegistryDir();
  const settingsPath = getSettingsPath();
  if (!existsSync(registryDir)) mkdirSync(registryDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(normalizeRoscoeSettings(settings), null, 2));
}

export function saveProjectContext(context: ProjectContext): void {
  const dir = getProjectMemoryDir(context.directory);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "project.json");
  writeFileSync(filePath, JSON.stringify(context, null, 2));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeInterviewAnswers(value: unknown): InterviewAnswer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typed = item as Record<string, unknown>;
      if (typeof typed.question !== "string" || typeof typed.answer !== "string") return null;
      return {
        question: typed.question,
        answer: typed.answer,
        ...(typeof typed.theme === "string" ? { theme: typed.theme } : {}),
        ...(typed.mode === "single" || typed.mode === "multi" ? { mode: typed.mode } : {}),
        ...(Array.isArray(typed.selectedOptions)
          ? { selectedOptions: normalizeStringArray(typed.selectedOptions) }
          : {}),
        ...(typeof typed.freeText === "string" ? { freeText: typed.freeText } : {}),
      };
    })
    .filter((item): item is InterviewAnswer => item !== null);
}

function normalizeQuestionRecords(value: unknown): InterviewQuestionRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typed = item as Record<string, unknown>;
      if (typeof typed.question !== "string") return null;
      const options = normalizeStringArray(typed.options);
      return {
        question: typed.question,
        options,
        ...(typeof typed.theme === "string" ? { theme: typed.theme } : {}),
        ...(typeof typed.purpose === "string" ? { purpose: typed.purpose } : {}),
        ...(typed.selectionMode === "single" || typed.selectionMode === "multi"
          ? { selectionMode: typed.selectionMode }
          : {}),
      };
    })
    .filter((item): item is InterviewQuestionRecord => item !== null);
}

function normalizeDeliveryPillars(value: unknown): DeliveryPillars {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    frontend: normalizeStringArray(typed.frontend),
    backend: normalizeStringArray(typed.backend),
    unitComponentTests: normalizeStringArray(typed.unitComponentTests),
    e2eTests: normalizeStringArray(typed.e2eTests),
  };
}

export function normalizeIntentBrief(
  context: Partial<ProjectContext>,
  value: unknown,
): IntentBrief {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    projectStory: typeof typed.projectStory === "string" && typed.projectStory.trim().length > 0
      ? typed.projectStory
      : context.notes || context.goals?.join("; ") || "Deliver the project goals without drifting scope.",
    primaryUsers: normalizeStringArray(typed.primaryUsers),
    definitionOfDone: normalizeStringArray(typed.definitionOfDone).length > 0
      ? normalizeStringArray(typed.definitionOfDone)
      : normalizeStringArray(context.goals),
    acceptanceChecks: normalizeStringArray(typed.acceptanceChecks).length > 0
      ? normalizeStringArray(typed.acceptanceChecks)
      : normalizeStringArray(context.milestones),
    successSignals: normalizeStringArray(typed.successSignals).length > 0
      ? normalizeStringArray(typed.successSignals)
      : normalizeStringArray(context.milestones),
    deliveryPillars: normalizeDeliveryPillars(typed.deliveryPillars),
    coverageMechanism: normalizeStringArray(typed.coverageMechanism),
    nonGoals: normalizeStringArray(typed.nonGoals),
    constraints: normalizeStringArray(typed.constraints),
    autonomyRules: normalizeStringArray(typed.autonomyRules),
    qualityBar: normalizeStringArray(typed.qualityBar),
    riskBoundaries: normalizeStringArray(typed.riskBoundaries),
    uiDirection: typeof typed.uiDirection === "string" ? typed.uiDirection : "",
  };
}

export function normalizeProjectContext(context: Partial<ProjectContext>): ProjectContext {
  const normalized: ProjectContext = {
    name: typeof context.name === "string" && context.name.trim().length > 0
      ? context.name
      : "project",
    directory: typeof context.directory === "string" ? context.directory : "",
    goals: normalizeStringArray(context.goals),
    milestones: normalizeStringArray(context.milestones),
    techStack: normalizeStringArray(context.techStack),
    notes: typeof context.notes === "string" ? context.notes : "",
    intentBrief: normalizeIntentBrief(context, context.intentBrief),
    interviewAnswers: normalizeInterviewAnswers(context.interviewAnswers),
    ...(context.runtimeDefaults ? { runtimeDefaults: context.runtimeDefaults } : {}),
  };

  return normalized;
}

function normalizeHistoryRecord(value: unknown): ProjectHistoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  if (
    typeof typed.id !== "string" ||
    (typed.mode !== "onboard" && typed.mode !== "refine") ||
    typeof typed.createdAt !== "string" ||
    typeof typed.directory !== "string" ||
    typeof typed.projectName !== "string" ||
    typeof typed.rawTranscript !== "string"
  ) {
    return null;
  }

  const runtime = typed.runtime && typeof typed.runtime === "object"
    ? typed.runtime as Record<string, unknown>
    : null;
  if (
    !runtime ||
    typeof runtime.profileName !== "string" ||
    (runtime.protocol !== "claude" && runtime.protocol !== "codex") ||
    typeof runtime.summary !== "string" ||
    !runtime.settings ||
    typeof runtime.settings !== "object"
  ) {
    return null;
  }

  return {
    id: typed.id,
    mode: typed.mode,
    createdAt: typed.createdAt,
    directory: typed.directory,
    projectName: typed.projectName,
    runtime: {
      profileName: runtime.profileName,
      protocol: runtime.protocol,
      summary: runtime.summary,
      settings: runtime.settings as RuntimeControlSettings,
    },
    rawTranscript: typed.rawTranscript,
    questions: normalizeQuestionRecords(typed.questions),
    answers: normalizeInterviewAnswers(typed.answers),
    briefSnapshot: normalizeProjectContext((typed.briefSnapshot ?? {}) as Partial<ProjectContext>),
  };
}

export function saveProjectHistory(record: ProjectHistoryRecord): void {
  const historyDir = getProjectHistoryDir(record.directory);
  if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
  const safeId = record.id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = join(historyDir, `${safeId}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2));
}

export function listProjectHistory(projectDir: string): ProjectHistoryRecord[] {
  const historyDir = getExistingProjectHistoryDir(projectDir);
  if (!historyDir) return [];
  if (!existsSync(historyDir)) return [];

  return readdirSync(historyDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const raw = readFileSync(join(historyDir, name), "utf-8");
        return normalizeHistoryRecord(JSON.parse(raw));
      } catch {
        return null;
      }
    })
    .filter((record): record is ProjectHistoryRecord => record !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Project Registry ────────────────────────────────────────

function loadRegistry(): ProjectRegistry {
  const registryPath = getExistingRegistryPath();
  if (!existsSync(registryPath)) return { projects: [] };
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf-8")) as ProjectRegistry;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    };
  } catch {
    return { projects: [] };
  }
}

function saveRegistry(registry: ProjectRegistry): void {
  const registryDir = getRegistryDir();
  const registryPath = getRegistryPath();
  if (!existsSync(registryDir)) mkdirSync(registryDir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify({ projects: sanitizeRegistryProjects(registry.projects) }, null, 2));
}

export function registerProject(name: string, directory: string): void {
  const registry = loadRegistry();
  const dir = resolve(directory);
  const existing = registry.projects.find((p) => p.directory === dir);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name;
    existing.lastActive = now;
  } else {
    registry.projects.push({
      name,
      directory: dir,
      onboardedAt: now,
      lastActive: now,
    });
  }
  saveRegistry(registry);
}

export function listRegisteredProjects(): ProjectRegistryEntry[] {
  const registry = loadRegistry();
  const cleaned = sanitizeRegistryProjects(registry.projects);
  if (cleaned.length !== registry.projects.length || cleaned.some((project, index) => {
    const existing = registry.projects[index];
    return !existing || existing.directory !== project.directory || existing.name !== project.name || existing.lastActive !== project.lastActive;
  })) {
    saveRegistry({ projects: cleaned });
  }
  return cleaned;
}

export function getProjectByName(name: string): ProjectRegistryEntry | undefined {
  return loadRegistry().projects.find((p) => p.name === name);
}

export function updateProjectLastActive(directory: string): void {
  const registry = loadRegistry();
  const dir = resolve(directory);
  const entry = registry.projects.find((p) => p.directory === dir);
  if (entry) {
    entry.lastActive = new Date().toISOString();
    saveRegistry(registry);
  }
}
