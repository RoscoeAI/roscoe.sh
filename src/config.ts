import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, copyFileSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { AuthProfile } from "./browser-agent.js";
import {
  detectProtocol,
  getProviderAdapter,
  HeadlessProfile,
  isLLMProtocol,
  LLMProtocol,
  RuntimeControlSettings,
  RuntimeRateLimitStatus,
  RuntimeUsageSnapshot,
} from "./llm-runtime.js";
import type { PreviewState, SessionStatus, TranscriptEntry } from "./types.js";
import type { PendingOperatorMessage } from "./types.js";
import type { Message } from "./conversation-tracker.js";
import {
  inferRoscoeDecision,
  normalizeLegacySidecarErrorText,
  normalizeRoscoeDraftMessage,
  parseRoscoeDraftPayload,
} from "./roscoe-draft.js";
import { DeploymentContract, normalizeDeploymentContract } from "./deployment-contract.js";
import { compactRedundantParkedConversation } from "./session-transcript.js";

export interface LLMProfile extends HeadlessProfile {}
export type InterviewSelectionMode = "single" | "multi";
export type OnboardingMode = "onboard" | "refine";
export type WorkerGovernanceMode = "roscoe-arbiter" | "guild-autonomous";
export type ResponderApprovalMode = "auto" | "manual";
export type VerificationCadence = "batched" | "prove-each-slice";
export type TokenEfficiencyMode = "balanced" | "save-tokens";

export interface ProjectRuntimeDefaults {
  lockedProvider?: LLMProtocol;
  guildProvider?: LLMProtocol;
  responderProvider?: LLMProtocol;
  workerByProtocol?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
  responderByProtocol?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
  onboarding?: {
    profileName: string;
    runtime: RuntimeControlSettings;
  };
  workerGovernanceMode?: WorkerGovernanceMode;
  verificationCadence?: VerificationCadence;
  tokenEfficiencyMode?: TokenEfficiencyMode;
  responderApprovalMode?: ResponderApprovalMode;
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

export type AcceptanceEvidenceStatus = "open" | "blocked" | "proven";
export type AcceptanceLedgerMode = "explicit" | "inferred";

export interface AcceptanceEvidenceItem {
  label: string;
  status: AcceptanceEvidenceStatus;
  evidence: string[];
  notes: string;
}

export interface EntrySurfaceContract {
  summary: string;
  defaultRoute: string;
  expectedExperience: string;
  allowedShellStates: string[];
}

export interface LocalRunContract {
  summary: string;
  startCommand: string;
  firstRoute: string;
  prerequisites: string[];
  seedRequirements: string[];
  expectedBlockedStates: string[];
  operatorSteps: string[];
}

export interface IntentBrief {
  projectStory: string;
  primaryUsers: string[];
  definitionOfDone: string[];
  acceptanceChecks: string[];
  successSignals: string[];
  entrySurfaceContract?: EntrySurfaceContract;
  localRunContract?: LocalRunContract;
  acceptanceLedgerMode?: AcceptanceLedgerMode;
  acceptanceLedger?: AcceptanceEvidenceItem[];
  deliveryPillars: DeliveryPillars;
  coverageMechanism: string[];
  deploymentContract?: DeploymentContract;
  nonGoals: string[];
  constraints: string[];
  architecturePrinciples?: string[];
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

export interface LaneSessionRecord {
  laneKey: string;
  projectDir: string;
  projectName: string;
  worktreePath: string;
  worktreeName: string;
  profileName: string;
  protocol: LLMProtocol;
  providerSessionId: string | null;
  responderProtocol: LLMProtocol | null;
  responderSessionId: string | null;
  trackerHistory: Message[];
  responderHistoryCursor: number;
  timeline: TranscriptEntry[];
  preview?: PreviewState;
  outputLines: string[];
  summary: string | null;
  currentToolUse: string | null;
  currentToolDetail?: string | null;
  status?: SessionStatus;
  startedAt: string;
  usage: RuntimeUsageSnapshot;
  rateLimitStatus: RuntimeRateLimitStatus | null;
  pendingOperatorMessages?: PendingOperatorMessage[];
  contractFingerprint?: string | null;
  savedAt: string;
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
  consentAcknowledged: boolean;
  consentProofUrls: string[];
  provider: "twilio";
  deliveryMode: "unconfigured" | "self-hosted" | "roscoe-hosted";
  hostedTestVerifiedPhone: string;
  hostedRelayClientId: string;
  hostedRelayAccessToken: string;
  hostedRelayAccessTokenExpiresAt: string;
  hostedRelayRefreshToken: string;
  hostedRelayLinkedPhone: string;
  hostedRelayLinkedEmail: string;
}

export interface ClaudeProviderSettings {
  enabled: boolean;
  brief: boolean;
  ide: boolean;
  chrome: boolean;
}

export interface CodexProviderSettings {
  enabled: boolean;
  webSearch: boolean;
}

export interface GeminiProviderSettings {
  enabled: boolean;
}

export interface RoscoeProviderSettings {
  claude: ClaudeProviderSettings;
  codex: CodexProviderSettings;
  gemini: GeminiProviderSettings;
}

export interface RoscoeBehaviorSettings {
  autoHealMetadata: boolean;
  preventSleepWhileRunning: boolean;
  parkAtMilestonesForReview: boolean;
}

export interface RoscoeSettings {
  notifications: SmsNotificationSettings;
  providers: RoscoeProviderSettings;
  behavior: RoscoeBehaviorSettings;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROFILES_DIR = join(__dirname, "..", "profiles");
const AUTH_PROFILES_DIR = join(PROFILES_DIR, "auth");
const ROSCOE_HOME_DIRNAME = ".roscoe";
const LEGACY_ROSCOE_HOME_DIRNAME = ".llm-responder";
export const ROSCOE_PROJECT_DIRNAME = ".roscoe";
export const LEGACY_ROSCOE_PROJECT_DIRNAME = ".llm-responder";

const projectRootCache = new Map<string, string>();
const canonicalStorageCache = new Map<string, string>();
const canonicalStorageMigrationCache = new Set<string>();
const laneSessionsCache = new Map<string, { mtimeMs: number; sessions: LaneSessionRecord[] }>();

export function resetConfigCachesForTests(): void {
  projectRootCache.clear();
  canonicalStorageCache.clear();
  canonicalStorageMigrationCache.clear();
  laneSessionsCache.clear();
}

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

export function resolveProjectRoot(projectDir: string): string {
  const dir = resolve(projectDir);
  const cached = projectRootCache.get(dir);
  if (cached) return cached;

  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    const resolvedRoot = root ? resolve(root) : dir;
    projectRootCache.set(dir, resolvedRoot);
    return resolvedRoot;
  } catch {
    projectRootCache.set(dir, dir);
    return dir;
  }
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

function getProjectSessionsPath(projectDir: string): string {
  return join(getProjectMemoryDir(projectDir), "sessions.json");
}

function getLegacyProjectSessionsPath(projectDir: string): string {
  return join(getLegacyProjectMemoryDir(projectDir), "sessions.json");
}

function getExistingProjectSessionsPath(projectDir: string): string | null {
  return resolveExistingPath(
    getProjectSessionsPath(projectDir),
    getLegacyProjectSessionsPath(projectDir),
  );
}

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) return;
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    if (statSync(sourcePath).isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else {
      const targetParent = dirname(targetPath);
      if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });
      if (!existsSync(targetPath)) {
        copyFileSync(sourcePath, targetPath);
      }
    }
  }
}

function ensureCanonicalProjectStorage(projectDir: string): string {
  const originalDir = resolve(projectDir);
  const cached = canonicalStorageCache.get(originalDir);
  if (cached) return cached;

  const canonicalDir = resolveProjectRoot(originalDir);
  canonicalStorageCache.set(originalDir, canonicalDir);
  canonicalStorageCache.set(canonicalDir, canonicalDir);
  if (canonicalDir === originalDir) return canonicalDir;

  const migrationKey = `${originalDir}=>${canonicalDir}`;
  if (canonicalStorageMigrationCache.has(migrationKey)) {
    return canonicalDir;
  }

  const canonicalMemoryDir = getProjectMemoryDir(canonicalDir);
  const legacySource = getLegacyProjectMemoryDir(originalDir);
  const primarySource = getProjectMemoryDir(originalDir);

  if (existsSync(legacySource)) copyDirectoryContents(legacySource, canonicalMemoryDir);
  if (existsSync(primarySource)) copyDirectoryContents(primarySource, canonicalMemoryDir);
  canonicalStorageMigrationCache.add(migrationKey);

  return canonicalDir;
}

function isEphemeralE2eProject(directory: string): boolean {
  return /[/\\](?:roscoe|llm-responder)-[^/\\]*e2e-[^/\\]+[/\\]project$/.test(directory);
}

function sanitizeRegistryProjects(projects: ProjectRegistryEntry[]): ProjectRegistryEntry[] {
  const byDirectory = new Map<string, ProjectRegistryEntry>();

  for (const project of projects) {
    if (!project || typeof project.directory !== "string" || typeof project.name !== "string") continue;
    const directory = ensureCanonicalProjectStorage(project.directory);
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

function applyProviderSettingsToProfile(
  profile: LLMProfile,
  providerSettings: RoscoeProviderSettings,
): LLMProfile {
  const protocol = detectProtocol(profile);
  const nextProfile: LLMProfile = {
    ...profile,
    args: getProviderAdapter(protocol).applyManagedArgs(
      [...profile.args],
      providerSettings[protocol],
    ),
  };
  return nextProfile;
}

export function loadProfile(name: string): LLMProfile {
  const filePath = join(PROFILES_DIR, `${name}.json`);
  const raw = readFileSync(filePath, "utf-8");
  return applyProviderSettingsToProfile(JSON.parse(raw) as LLMProfile, loadRoscoeSettings().providers);
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
  const canonicalDir = ensureCanonicalProjectStorage(projectDir);
  const filePath = getExistingProjectContextPath(canonicalDir);
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<ProjectContext>;
  const normalized = normalizeProjectContext(parsed);
  if (stableSerialize(parsed) !== stableSerialize(normalized)) {
    saveProjectContext(normalized);
  }
  return normalized;
}

function normalizeRuntimeControlSettings(value: unknown): RuntimeControlSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const normalized: RuntimeControlSettings = {};

  if (typed.executionMode === "safe" || typed.executionMode === "accelerated") {
    normalized.executionMode = typed.executionMode;
  }
  if (typed.tuningMode === "manual" || typed.tuningMode === "auto") {
    normalized.tuningMode = typed.tuningMode;
  }
  if (typeof typed.model === "string" && typed.model.trim().length > 0) {
    normalized.model = typed.model;
  }
  if (typeof typed.reasoningEffort === "string" && typed.reasoningEffort.trim().length > 0) {
    normalized.reasoningEffort = typed.reasoningEffort;
  }
  if (typeof typed.permissionMode === "string" && typed.permissionMode.trim().length > 0) {
    normalized.permissionMode = typed.permissionMode;
  }
  if (typeof typed.sandboxMode === "string" && typed.sandboxMode.trim().length > 0) {
    normalized.sandboxMode = typed.sandboxMode;
  }
  if (typeof typed.approvalPolicy === "string" && typed.approvalPolicy.trim().length > 0) {
    normalized.approvalPolicy = typed.approvalPolicy;
  }
  if (typed.dangerouslySkipPermissions === true) {
    normalized.dangerouslySkipPermissions = true;
  }
  if (typed.bypassApprovalsAndSandbox === true) {
    normalized.bypassApprovalsAndSandbox = true;
  }

  return normalized;
}

function normalizeProjectRuntimeDefaults(value: unknown): ProjectRuntimeDefaults | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as Record<string, unknown>;
  const normalized: ProjectRuntimeDefaults = {};

  if (isLLMProtocol(typed.lockedProvider)) {
    normalized.lockedProvider = typed.lockedProvider;
  }
  if (isLLMProtocol(typed.guildProvider)) {
    normalized.guildProvider = typed.guildProvider;
  }
  if (isLLMProtocol(typed.responderProvider)) {
    normalized.responderProvider = typed.responderProvider;
  }
  if (!normalized.guildProvider && normalized.lockedProvider) {
    normalized.guildProvider = normalized.lockedProvider;
  }
  if (!normalized.responderProvider && normalized.lockedProvider) {
    normalized.responderProvider = normalized.lockedProvider;
  }

  const workerByProtocol = typed.workerByProtocol && typeof typed.workerByProtocol === "object"
    ? typed.workerByProtocol as Record<string, unknown>
    : null;
  if (workerByProtocol) {
    const normalizedWorkers: ProjectRuntimeDefaults["workerByProtocol"] = {};
    for (const protocol of ["claude", "codex", "gemini"] as const) {
      if (workerByProtocol[protocol] && typeof workerByProtocol[protocol] === "object") {
        normalizedWorkers[protocol] = normalizeRuntimeControlSettings(workerByProtocol[protocol]);
      }
    }
    if (Object.keys(normalizedWorkers).length > 0) {
      normalized.workerByProtocol = normalizedWorkers;
    }
  }

  const responderByProtocol = typed.responderByProtocol && typeof typed.responderByProtocol === "object"
    ? typed.responderByProtocol as Record<string, unknown>
    : null;
  if (responderByProtocol) {
    const normalizedResponders: ProjectRuntimeDefaults["responderByProtocol"] = {};
    for (const protocol of ["claude", "codex", "gemini"] as const) {
      if (responderByProtocol[protocol] && typeof responderByProtocol[protocol] === "object") {
        normalizedResponders[protocol] = normalizeRuntimeControlSettings(responderByProtocol[protocol]);
      }
    }
    if (Object.keys(normalizedResponders).length > 0) {
      normalized.responderByProtocol = normalizedResponders;
    }
  }

  const onboarding = typed.onboarding && typeof typed.onboarding === "object"
    ? typed.onboarding as Record<string, unknown>
    : null;
  if (onboarding && typeof onboarding.profileName === "string" && onboarding.profileName.trim().length > 0) {
    normalized.onboarding = {
      profileName: onboarding.profileName,
      runtime: normalizeRuntimeControlSettings(onboarding.runtime),
    };
  }

  if (typed.workerGovernanceMode === "roscoe-arbiter" || typed.workerGovernanceMode === "guild-autonomous") {
    normalized.workerGovernanceMode = typed.workerGovernanceMode;
  }

  if (typed.verificationCadence === "batched" || typed.verificationCadence === "prove-each-slice") {
    normalized.verificationCadence = typed.verificationCadence;
  }
  if (typed.tokenEfficiencyMode === "balanced" || typed.tokenEfficiencyMode === "save-tokens") {
    normalized.tokenEfficiencyMode = typed.tokenEfficiencyMode;
  }

  if (typed.responderApprovalMode === "auto" || typed.responderApprovalMode === "manual") {
    normalized.responderApprovalMode = typed.responderApprovalMode;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeSmsNotificationSettings(value: unknown): SmsNotificationSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const deliveryMode =
    typed.deliveryMode === "self-hosted" || typed.deliveryMode === "roscoe-hosted"
      ? typed.deliveryMode
      : "unconfigured";
  return {
    enabled: typed.enabled === true,
    phoneNumber: typeof typed.phoneNumber === "string" ? typed.phoneNumber : "",
    consentAcknowledged: typed.consentAcknowledged === true,
    consentProofUrls: normalizeStringArray(typed.consentProofUrls),
    provider: "twilio",
    deliveryMode,
    hostedTestVerifiedPhone: typeof typed.hostedTestVerifiedPhone === "string" ? typed.hostedTestVerifiedPhone : "",
    hostedRelayClientId: typeof typed.hostedRelayClientId === "string" ? typed.hostedRelayClientId : "",
    hostedRelayAccessToken: typeof typed.hostedRelayAccessToken === "string" ? typed.hostedRelayAccessToken : "",
    hostedRelayAccessTokenExpiresAt: typeof typed.hostedRelayAccessTokenExpiresAt === "string" ? typed.hostedRelayAccessTokenExpiresAt : "",
    hostedRelayRefreshToken: typeof typed.hostedRelayRefreshToken === "string" ? typed.hostedRelayRefreshToken : "",
    hostedRelayLinkedPhone: typeof typed.hostedRelayLinkedPhone === "string" ? typed.hostedRelayLinkedPhone : "",
    hostedRelayLinkedEmail: typeof typed.hostedRelayLinkedEmail === "string" ? typed.hostedRelayLinkedEmail : "",
  };
}

function normalizeMessageHistory(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typed = item as Record<string, unknown>;
      if (
        (typed.role !== "assistant" && typed.role !== "user" && typed.role !== "system") ||
        typeof typed.content !== "string"
      ) {
        return null;
      }

      return {
        role: typed.role,
        content: typed.content,
        timestamp: typeof typed.timestamp === "number" ? typed.timestamp : 0,
      } as Message;
    })
    .filter((item): item is Message => item !== null);
}

function normalizeTranscriptEntry(value: unknown): TranscriptEntry | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  if (typeof typed.id !== "string" || typeof typed.timestamp !== "number" || typeof typed.kind !== "string") {
    return null;
  }

  switch (typed.kind) {
    case "remote-turn":
      if (typeof typed.provider !== "string" || typeof typed.text !== "string") return null;
      return {
        id: typed.id,
        timestamp: typed.timestamp,
        kind: "remote-turn",
        provider: typed.provider,
        text: typed.text,
        activity: typeof typed.activity === "string" ? typed.activity : null,
        note: typeof typed.note === "string" ? typed.note : null,
      };
    case "local-suggestion":
      if (
        typeof typed.text !== "string" ||
        typeof typed.confidence !== "number" ||
        typeof typed.reasoning !== "string" ||
        (typed.state !== "pending" && typed.state !== "dismissed")
      ) {
        return null;
      }
      return {
        id: typed.id,
        timestamp: typed.timestamp,
        kind: "local-suggestion",
        text: normalizeRoscoeDraftMessage(typed.text),
        confidence: typed.confidence,
        reasoning: typed.reasoning,
        state: typed.state,
      };
    case "local-sent":
      if (
        typeof typed.text !== "string" ||
        (typed.delivery !== "approved" && typed.delivery !== "edited" && typed.delivery !== "manual" && typed.delivery !== "auto")
      ) {
        return null;
      }
      const parsedDraft = parseRoscoeDraftPayload(typed.text);
      return {
        id: typed.id,
        timestamp: typed.timestamp,
        kind: "local-sent",
        text: normalizeRoscoeDraftMessage(typed.text),
        delivery: typed.delivery,
        ...(typeof typed.confidence === "number"
          ? { confidence: typed.confidence }
          : typeof parsedDraft?.confidence === "number"
            ? { confidence: parsedDraft.confidence }
            : {}),
        ...(typeof typed.reasoning === "string"
          ? { reasoning: typed.reasoning }
          : typeof parsedDraft?.reasoning === "string"
            ? { reasoning: parsedDraft.reasoning }
            : {}),
      };
    case "tool-activity":
      if (typeof typed.provider !== "string" || typeof typed.toolName !== "string" || typeof typed.text !== "string") return null;
      return {
        id: typed.id,
        timestamp: typed.timestamp,
        kind: "tool-activity",
        provider: typed.provider,
        toolName: typed.toolName,
        text: typed.text,
      };
    case "preview":
      if ((typed.state !== "queued" && typed.state !== "ready") || typeof typed.text !== "string") return null;
      return {
        id: typed.id,
        timestamp: typed.timestamp,
        kind: "preview",
        state: typed.state,
        text: typed.text,
        link: typeof typed.link === "string" ? typed.link : null,
      };
    case "error":
      if (typeof typed.text !== "string" || (typed.source !== "sidecar" && typed.source !== "session")) return null;
      return {
        id: typed.id,
        timestamp: typed.timestamp,
        kind: "error",
        text: typed.source === "sidecar" ? normalizeLegacySidecarErrorText(typed.text) : typed.text,
        source: typed.source,
      };
    default:
      return null;
  }
}

function compactPendingSuggestions(entries: TranscriptEntry[]): TranscriptEntry[] {
  let latestPendingSuggestionIndex = -1;
  entries.forEach((entry, index) => {
    if (entry.kind === "local-suggestion" && entry.state === "pending") {
      latestPendingSuggestionIndex = index;
    }
  });

  if (latestPendingSuggestionIndex === -1) {
    return entries;
  }

  return entries.filter((entry, index) =>
    entry.kind !== "local-suggestion" || entry.state !== "pending" || index === latestPendingSuggestionIndex,
  );
}

function dismissStaleNoOpSuggestions(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== "local-suggestion" || entry.state !== "pending") {
      return entry;
    }
    return inferRoscoeDecision({ message: entry.text, reasoning: entry.reasoning }) === "noop"
      ? { ...entry, state: "dismissed" as const }
      : entry;
  });
}

function normalizeTranscript(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map((item) => normalizeTranscriptEntry(item))
    .filter((item): item is TranscriptEntry => item !== null);
  return compactRedundantParkedConversation(dismissStaleNoOpSuggestions(compactPendingSuggestions(entries)));
}

function normalizeLaneSessionRecord(value: unknown): LaneSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  if (
    typeof typed.laneKey !== "string" ||
    typeof typed.projectDir !== "string" ||
    typeof typed.projectName !== "string" ||
    typeof typed.worktreePath !== "string" ||
    typeof typed.worktreeName !== "string" ||
    typeof typed.profileName !== "string" ||
    !isLLMProtocol(typed.protocol)
  ) {
    return null;
  }

  const projectDir = ensureCanonicalProjectStorage(typed.projectDir);
  const worktreePath = resolveProjectRoot(typed.worktreePath);
  const laneKey = buildLaneSessionKey(projectDir, worktreePath, typed.worktreeName, typed.profileName);

  return {
    laneKey,
    projectDir,
    projectName: typed.projectName,
    worktreePath,
    worktreeName: typed.worktreeName,
    profileName: typed.profileName,
    protocol: typed.protocol,
    providerSessionId: typeof typed.providerSessionId === "string" ? typed.providerSessionId : null,
    responderProtocol: isLLMProtocol(typed.responderProtocol)
      ? typed.responderProtocol
      : null,
    responderSessionId: typeof typed.responderSessionId === "string" ? typed.responderSessionId : null,
    trackerHistory: normalizeMessageHistory(typed.trackerHistory),
    responderHistoryCursor: typeof typed.responderHistoryCursor === "number" && Number.isFinite(typed.responderHistoryCursor)
      ? Math.max(0, Math.floor(typed.responderHistoryCursor))
      : 0,
    timeline: normalizeTranscript(typed.timeline),
    preview: normalizePreviewState(typed.preview),
    outputLines: normalizeStringArray(typed.outputLines),
    summary: typeof typed.summary === "string" ? typed.summary : null,
    currentToolUse: typeof typed.currentToolUse === "string" ? typed.currentToolUse : null,
    currentToolDetail: typeof typed.currentToolDetail === "string" ? typed.currentToolDetail : null,
    status: typed.status === "active"
      || typed.status === "waiting"
      || typed.status === "idle"
      || typed.status === "generating"
      || typed.status === "paused"
      || typed.status === "blocked"
      || typed.status === "review"
      || typed.status === "parked"
      || typed.status === "exited"
      ? typed.status
      : undefined,
    startedAt: normalizeIsoTimestamp(typed.startedAt),
    usage: normalizeRuntimeUsageSnapshot(typed.usage),
    rateLimitStatus: normalizeRuntimeRateLimitStatus(typed.rateLimitStatus),
    pendingOperatorMessages: normalizePendingOperatorMessages(typed.pendingOperatorMessages),
    contractFingerprint: typeof typed.contractFingerprint === "string" ? typed.contractFingerprint : null,
    savedAt: typeof typed.savedAt === "string" ? typed.savedAt : new Date(0).toISOString(),
  };
}

function normalizeLaneSessionRecords(value: unknown): LaneSessionRecord[] {
  if (!Array.isArray(value)) return [];
  const latestByLane = new Map<string, LaneSessionRecord>();

  for (const item of value) {
    const normalized = normalizeLaneSessionRecord(item);
    if (!normalized) continue;

    const existing = latestByLane.get(normalized.laneKey);
    if (!existing || normalized.savedAt > existing.savedAt) {
      latestByLane.set(normalized.laneKey, normalized);
    }
  }

  return Array.from(latestByLane.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function normalizeClaudeProviderSettings(value: unknown): ClaudeProviderSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: typed.enabled !== false,
    brief: typed.brief === true,
    ide: typed.ide === true,
    chrome: typed.chrome === true,
  };
}

function normalizeCodexProviderSettings(value: unknown): CodexProviderSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: typed.enabled !== false,
    webSearch: typed.webSearch === true,
  };
}

function normalizeGeminiProviderSettings(value: unknown): GeminiProviderSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: typed.enabled !== false,
  };
}

function normalizeProviderSettings(value: unknown): RoscoeProviderSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    claude: normalizeClaudeProviderSettings(typed.claude),
    codex: normalizeCodexProviderSettings(typed.codex),
    gemini: normalizeGeminiProviderSettings(typed.gemini),
  };
}

function normalizeBehaviorSettings(value: unknown): RoscoeBehaviorSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    autoHealMetadata: typed.autoHealMetadata !== false,
    preventSleepWhileRunning: typed.preventSleepWhileRunning !== false,
    parkAtMilestonesForReview: typed.parkAtMilestonesForReview === true,
  };
}

function normalizeRoscoeSettings(value: unknown): RoscoeSettings {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    notifications: normalizeSmsNotificationSettings(typed.notifications),
    providers: normalizeProviderSettings(typed.providers),
    behavior: normalizeBehaviorSettings(typed.behavior),
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

export function ensureHostedRelayClientId(): string {
  const settings = loadRoscoeSettings();
  if (settings.notifications.hostedRelayClientId) {
    return settings.notifications.hostedRelayClientId;
  }

  const clientId = `relay-${randomUUID()}`;
  saveRoscoeSettings({
    ...settings,
    notifications: {
      ...settings.notifications,
      hostedRelayClientId: clientId,
    },
  });
  return clientId;
}

export function saveProjectContext(context: ProjectContext): void {
  const canonicalDir = ensureCanonicalProjectStorage(context.directory);
  const dir = getProjectMemoryDir(canonicalDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "project.json");
  writeFileSync(filePath, JSON.stringify(normalizeProjectContext({
    ...context,
    directory: canonicalDir,
  }), null, 2));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizePendingOperatorMessages(value: unknown): PendingOperatorMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typed = item as Record<string, unknown>;
      if (typeof typed.id !== "string" || typeof typed.text !== "string") {
        return null;
      }

      return {
        id: typed.id,
        text: typed.text,
        via: typed.via === "hosted-sms" ? "hosted-sms" : "sms",
        from: typeof typed.from === "string" ? typed.from : null,
        receivedAt: typeof typed.receivedAt === "number" && Number.isFinite(typed.receivedAt)
          ? typed.receivedAt
          : Date.now(),
        token: typeof typed.token === "string" ? typed.token : undefined,
      } as PendingOperatorMessage;
    })
    .filter((item): item is PendingOperatorMessage => item !== null);
}

function normalizeIsoTimestamp(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : new Date(0).toISOString();
}

function normalizeRuntimeUsageSnapshot(value: unknown): RuntimeUsageSnapshot {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const normalize = (entry: unknown) =>
    typeof entry === "number" && Number.isFinite(entry) && entry > 0 ? Math.floor(entry) : 0;

  return {
    inputTokens: normalize(typed.inputTokens),
    outputTokens: normalize(typed.outputTokens),
    cachedInputTokens: normalize(typed.cachedInputTokens),
    cacheCreationInputTokens: normalize(typed.cacheCreationInputTokens),
  };
}

function normalizeRuntimeRateLimitStatus(value: unknown): RuntimeRateLimitStatus | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  if (!isLLMProtocol(typed.source)) return null;

  return {
    source: typed.source,
    windowLabel: typeof typed.windowLabel === "string" ? typed.windowLabel : null,
    status: typeof typed.status === "string" ? typed.status : null,
    resetsAt: typeof typed.resetsAt === "string" ? typed.resetsAt : null,
  };
}

function normalizePreviewState(value: unknown): PreviewState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as Record<string, unknown>;
  if (typed.mode !== "queued" && typed.mode !== "ready") return undefined;

  return {
    mode: typed.mode,
    message: typeof typed.message === "string" ? typed.message : null,
    link: typeof typed.link === "string" ? typed.link : null,
  };
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

function defaultArchitecturePrinciples(): string[] {
  return [
    "Favor shared components and shared domain modules over duplicated feature-specific implementations.",
    "Keep material writes, external integrations, and background or queued work behind explicit service seams with consistent audit logging.",
  ];
}

function truncateContractText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function inferUiProject(context: Partial<ProjectContext>, intent: Record<string, unknown>): boolean {
  const corpus = [
    ...(context.techStack ?? []),
    ...(normalizeStringArray(intent.definitionOfDone)),
    ...(normalizeStringArray(intent.acceptanceChecks)),
    ...(normalizeStringArray(intent.successSignals)),
    typeof intent.projectStory === "string" ? intent.projectStory : "",
    typeof context.notes === "string" ? context.notes : "",
  ]
    .join(" ")
    .toLowerCase();
  return /(react|tanstack|next|vite|frontend|ui|route|page|screen|builder|embed|preview|landing|homepage|dashboard|operator|creator|browser|web app)/.test(corpus);
}

function extractFirstCommand(candidates: string[]): string {
  const commandPatterns = [
    /\b(pnpm(?:\s+--[^\s=]+(?:[=\s][^\s]+)?)*\s+(?:run\s+)?[a-z0-9:-]+)/i,
    /\b(npm\s+run\s+[a-z0-9:-]+)/i,
    /\b(yarn\s+[a-z0-9:-]+)/i,
    /\b(bun\s+[a-z0-9:-]+)/i,
  ];
  for (const candidate of candidates) {
    for (const pattern of commandPatterns) {
      const match = candidate.match(pattern);
      if (match?.[1]) {
        return match[1].trim().replace(/\s+$/, "");
      }
    }
  }
  return "";
}

function extractFirstUrl(candidates: string[]): string {
  for (const candidate of candidates) {
    const match = candidate.match(/https?:\/\/[^\s)]+/i);
    if (match?.[0]) {
      return match[0].trim();
    }
  }
  return "";
}

function deriveEntrySurfaceContract(
  context: Partial<ProjectContext>,
  typed: Record<string, unknown>,
  definitionOfDone: string[],
  acceptanceChecks: string[],
  successSignals: string[],
): EntrySurfaceContract | undefined {
  const explicit = normalizeEntrySurfaceContract(typed.entrySurfaceContract);
  if (explicit) return explicit;
  if (!inferUiProject(context, typed)) return undefined;

  const expectedExperience = truncateContractText(
    acceptanceChecks[0]
      || definitionOfDone[0]
      || successSignals[0]
      || "The default first screen should honestly reflect what works locally and what remains blocked.",
  );

  return {
    summary: "The default first surface should be a truthful operator-facing entry point on first boot.",
    defaultRoute: "/",
    expectedExperience,
    allowedShellStates: [],
  };
}

function deriveLocalRunContract(
  context: Partial<ProjectContext>,
  typed: Record<string, unknown>,
  definitionOfDone: string[],
  acceptanceChecks: string[],
  successSignals: string[],
): LocalRunContract | undefined {
  const explicit = normalizeLocalRunContract(typed.localRunContract);
  const uiProject = inferUiProject(context, typed);
  if (explicit) {
    if (uiProject && /\b(test|lint|typecheck|check)\b/i.test(explicit.startCommand)) {
      return {
        ...explicit,
        startCommand: "pnpm dev",
        firstRoute: explicit.firstRoute || "http://localhost:3000",
        operatorSteps: [
          "Run `pnpm dev`.",
          `Open \`${explicit.firstRoute || "http://localhost:3000"}\` and verify the truthful default experience.`,
        ],
      };
    }
    return explicit;
  }

  const supportingText = [
    typeof context.notes === "string" ? context.notes : "",
    ...normalizeStringArray(typed.coverageMechanism),
    ...acceptanceChecks,
    ...definitionOfDone,
    ...successSignals,
  ].filter(Boolean);
  const lowerCorpus = supportingText.join(" ").toLowerCase();
  const looksLikeLocalWorkflow = uiProject || /\b(localhost|pnpm dev|npm run dev|preview|embed|tenant|auth|seed|postgres|database)\b/.test(lowerCorpus);
  if (!looksLikeLocalWorkflow) return undefined;

  const extractedCommand = extractFirstCommand(supportingText);
  const startCommand = /(?:^|\s)(dev|start|serve|preview)(?:$|\s)/i.test(extractedCommand)
    ? extractedCommand
    : uiProject
      ? "pnpm dev"
      : extractedCommand;
  const firstRoute = extractFirstUrl(supportingText) || (uiProject ? "http://localhost:3000" : "");
  const prerequisites: string[] = [];
  const seedRequirements: string[] = [];

  if (/\bsign in\b|auth|betterauth|cookie/i.test(lowerCorpus)) {
    prerequisites.push("Authentication requirements must be surfaced honestly before the local happy path is considered ready.");
  }
  if (/\btenant\b|\boperator\b/i.test(lowerCorpus)) {
    seedRequirements.push("Any required tenant or operator bootstrap must be explicit before local validation is treated as complete.");
  }
  if (/\bseed\b|\bdemo tenant\b|\bbootstrap\b/i.test(lowerCorpus)) {
    seedRequirements.push("Required seed data or demo entities must be documented before the local flow is called done.");
  }
  if (/\bpostgres\b|\bprisma\b|\bdatabase\b|\bneon\b/i.test(lowerCorpus)) {
    prerequisites.push("Database prerequisites must be stated before the local run path is treated as healthy.");
  }

  const operatorSteps = [
    startCommand ? `Run \`${startCommand}\`.` : "",
    firstRoute ? `Open \`${firstRoute}\` and verify the truthful default experience.` : "",
  ].filter(Boolean);

  return {
    summary: "Local boot should expose the real happy path and any missing prerequisites honestly.",
    startCommand,
    firstRoute,
    prerequisites: Array.from(new Set(prerequisites)),
    seedRequirements: Array.from(new Set(seedRequirements)),
    expectedBlockedStates: [],
    operatorSteps,
  };
}

function normalizeEntrySurfaceContract(value: unknown): EntrySurfaceContract | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as Record<string, unknown>;
  const summary = typeof typed.summary === "string" ? typed.summary.trim() : "";
  const defaultRoute = typeof typed.defaultRoute === "string" ? typed.defaultRoute.trim() : "";
  const expectedExperience = typeof typed.expectedExperience === "string" ? typed.expectedExperience.trim() : "";
  const allowedShellStates = normalizeStringArray(typed.allowedShellStates);

  if (!summary && !defaultRoute && !expectedExperience && allowedShellStates.length === 0) {
    return undefined;
  }

  return {
    summary,
    defaultRoute,
    expectedExperience,
    allowedShellStates,
  };
}

function normalizeLocalRunContract(value: unknown): LocalRunContract | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as Record<string, unknown>;
  const summary = typeof typed.summary === "string" ? typed.summary.trim() : "";
  const startCommand = typeof typed.startCommand === "string" ? typed.startCommand.trim() : "";
  const firstRoute = typeof typed.firstRoute === "string" ? typed.firstRoute.trim() : "";
  const prerequisites = normalizeStringArray(typed.prerequisites);
  const seedRequirements = normalizeStringArray(typed.seedRequirements);
  const expectedBlockedStates = normalizeStringArray(typed.expectedBlockedStates);
  const operatorSteps = normalizeStringArray(typed.operatorSteps);

  if (
    !summary
    && !startCommand
    && !firstRoute
    && prerequisites.length === 0
    && seedRequirements.length === 0
    && expectedBlockedStates.length === 0
    && operatorSteps.length === 0
  ) {
    return undefined;
  }

  return {
    summary,
    startCommand,
    firstRoute,
    prerequisites,
    seedRequirements,
    expectedBlockedStates,
    operatorSteps,
  };
}

function normalizeAcceptanceEvidenceStatus(value: unknown): AcceptanceEvidenceStatus {
  return value === "blocked" || value === "proven" ? value : "open";
}

function buildDefaultAcceptanceLedger(
  definitionOfDone: string[],
  acceptanceChecks: string[],
): AcceptanceEvidenceItem[] {
  const labels = Array.from(new Set([
    ...definitionOfDone.slice(0, 4),
    ...acceptanceChecks.slice(0, 4),
  ].map((item) => item.trim()).filter(Boolean)));

  return labels.map((label) => ({
    label,
    status: "open" as const,
    evidence: [],
    notes: "",
  }));
}

function determineAcceptanceLedgerMode(
  typed: Record<string, unknown>,
  value: unknown,
  normalizedLedger: AcceptanceEvidenceItem[],
  defaultLedger: AcceptanceEvidenceItem[],
): AcceptanceLedgerMode {
  if (typed.acceptanceLedgerMode === "explicit" || typed.acceptanceLedgerMode === "inferred") {
    return typed.acceptanceLedgerMode;
  }

  if (!Array.isArray(value)) {
    return "inferred";
  }

  if (
    normalizedLedger.length === defaultLedger.length
    && normalizedLedger.every((item, index) => {
      const expected = defaultLedger[index];
      return Boolean(expected)
        && item.label === expected.label
        && item.status === "open"
        && item.evidence.length === 0
        && item.notes === "";
    })
  ) {
    return "inferred";
  }

  return "explicit";
}

function normalizeAcceptanceLedger(
  value: unknown,
  definitionOfDone: string[],
  acceptanceChecks: string[],
): AcceptanceEvidenceItem[] {
  if (!Array.isArray(value)) {
    return buildDefaultAcceptanceLedger(definitionOfDone, acceptanceChecks);
  }

  const normalized = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typed = item as Record<string, unknown>;
      if (typeof typed.label !== "string" || !typed.label.trim()) return null;
      return {
        label: typed.label.trim(),
        status: normalizeAcceptanceEvidenceStatus(typed.status),
        evidence: normalizeStringArray(typed.evidence),
        notes: typeof typed.notes === "string" ? typed.notes : "",
      } satisfies AcceptanceEvidenceItem;
    })
    .filter((item): item is AcceptanceEvidenceItem => item !== null);

  if (normalized.length === 0) {
    return buildDefaultAcceptanceLedger(definitionOfDone, acceptanceChecks);
  }

  return normalized;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    return `{${Object.keys(typed).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(typed[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeIntentBrief(
  context: Partial<ProjectContext>,
  value: unknown,
): IntentBrief {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const definitionOfDone = normalizeStringArray(typed.definitionOfDone).length > 0
    ? normalizeStringArray(typed.definitionOfDone)
    : normalizeStringArray(context.goals);
  const acceptanceChecks = normalizeStringArray(typed.acceptanceChecks).length > 0
    ? normalizeStringArray(typed.acceptanceChecks)
    : normalizeStringArray(context.milestones);
  const successSignals = normalizeStringArray(typed.successSignals).length > 0
    ? normalizeStringArray(typed.successSignals)
    : normalizeStringArray(context.milestones);
  const defaultAcceptanceLedger = buildDefaultAcceptanceLedger(definitionOfDone, acceptanceChecks);
  const acceptanceLedger = normalizeAcceptanceLedger(typed.acceptanceLedger, definitionOfDone, acceptanceChecks);
  const acceptanceLedgerMode = determineAcceptanceLedgerMode(
    typed,
    typed.acceptanceLedger,
    acceptanceLedger,
    defaultAcceptanceLedger,
  );
  return {
    projectStory: typeof typed.projectStory === "string" && typed.projectStory.trim().length > 0
      ? typed.projectStory
      : context.notes || context.goals?.join("; ") || "Deliver the project goals without drifting scope.",
    primaryUsers: normalizeStringArray(typed.primaryUsers),
    definitionOfDone,
    acceptanceChecks,
    successSignals,
    entrySurfaceContract: deriveEntrySurfaceContract(context, typed, definitionOfDone, acceptanceChecks, successSignals),
    localRunContract: deriveLocalRunContract(context, typed, definitionOfDone, acceptanceChecks, successSignals),
    acceptanceLedgerMode,
    acceptanceLedger,
    deliveryPillars: normalizeDeliveryPillars(typed.deliveryPillars),
    coverageMechanism: normalizeStringArray(typed.coverageMechanism),
    deploymentContract: normalizeDeploymentContract(
      typeof context.directory === "string" ? context.directory : undefined,
      typed.deploymentContract,
    ),
    nonGoals: normalizeStringArray(typed.nonGoals),
    constraints: normalizeStringArray(typed.constraints),
    architecturePrinciples: normalizeStringArray(typed.architecturePrinciples).length > 0
      ? normalizeStringArray(typed.architecturePrinciples)
      : defaultArchitecturePrinciples(),
    autonomyRules: normalizeStringArray(typed.autonomyRules),
    qualityBar: normalizeStringArray(typed.qualityBar),
    riskBoundaries: normalizeStringArray(typed.riskBoundaries),
    uiDirection: typeof typed.uiDirection === "string" ? typed.uiDirection : "",
  };
}

export function normalizeProjectContext(context: Partial<ProjectContext>): ProjectContext {
  const normalizedDirectory = typeof context.directory === "string" ? ensureCanonicalProjectStorage(context.directory) : "";
  const normalizedRuntimeDefaults = normalizeProjectRuntimeDefaults(context.runtimeDefaults);
  const normalized: ProjectContext = {
    name: typeof context.name === "string" && context.name.trim().length > 0
      ? context.name
      : "project",
    directory: normalizedDirectory,
    goals: normalizeStringArray(context.goals),
    milestones: normalizeStringArray(context.milestones),
    techStack: normalizeStringArray(context.techStack),
    notes: typeof context.notes === "string" ? context.notes : "",
    intentBrief: normalizeIntentBrief(context, context.intentBrief),
    interviewAnswers: normalizeInterviewAnswers(context.interviewAnswers),
    ...(normalizedRuntimeDefaults ? { runtimeDefaults: normalizedRuntimeDefaults } : {}),
  };

  return normalized;
}

export function getProjectContractFingerprint(context: ProjectContext | null): string | null {
  if (!context) return null;
  const normalized = normalizeProjectContext(context);
  const serialized = stableSerialize({
    goals: normalized.goals,
    milestones: normalized.milestones,
    notes: normalized.notes,
    techStack: normalized.techStack,
    intentBrief: normalized.intentBrief,
    runtimeDefaults: normalized.runtimeDefaults ?? null,
  });
  return hashString(serialized);
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
    directory: ensureCanonicalProjectStorage(typed.directory),
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
  const canonicalDir = ensureCanonicalProjectStorage(record.directory);
  const historyDir = getProjectHistoryDir(canonicalDir);
  if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
  const safeId = record.id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = join(historyDir, `${safeId}.json`);
  writeFileSync(filePath, JSON.stringify({
    ...record,
    directory: canonicalDir,
    briefSnapshot: {
      ...record.briefSnapshot,
      directory: canonicalDir,
    },
  }, null, 2));
}

export function listProjectHistory(projectDir: string): ProjectHistoryRecord[] {
  const canonicalDir = ensureCanonicalProjectStorage(projectDir);
  const historyDir = getExistingProjectHistoryDir(canonicalDir);
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
  const dir = ensureCanonicalProjectStorage(directory);
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
  return sanitizeRegistryProjects(loadRegistry().projects).find((p) => p.name === name);
}

export function updateProjectLastActive(directory: string): void {
  const registry = loadRegistry();
  const dir = ensureCanonicalProjectStorage(directory);
  const entry = registry.projects.find((p) => p.directory === dir);
  if (entry) {
    entry.lastActive = new Date().toISOString();
    saveRegistry(registry);
  }
}

export function buildLaneSessionKey(
  projectDir: string,
  worktreePath: string,
  worktreeName: string,
  profileName: string,
): string {
  const canonicalProjectDir = ensureCanonicalProjectStorage(projectDir);
  const canonicalWorktreePath = resolveProjectRoot(worktreePath);
  return [
    canonicalProjectDir,
    canonicalWorktreePath,
    worktreeName,
    profileName,
  ].join("::");
}

export function listLaneSessions(projectDir: string): LaneSessionRecord[] {
  const canonicalDir = ensureCanonicalProjectStorage(projectDir);
  const sessionsPath = getExistingProjectSessionsPath(canonicalDir);
  if (!sessionsPath || !existsSync(sessionsPath)) return [];

  try {
    const mtimeMs = statSync(sessionsPath).mtimeMs;
    const cached = laneSessionsCache.get(sessionsPath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.sessions;
    }

    const parsed = JSON.parse(readFileSync(sessionsPath, "utf-8")) as { sessions?: unknown };
    const sessions = normalizeLaneSessionRecords(parsed.sessions);
    laneSessionsCache.set(sessionsPath, { mtimeMs, sessions });
    return sessions;
  } catch {
    return [];
  }
}

export function loadLaneSession(
  projectDir: string,
  worktreePath: string,
  worktreeName: string,
  profileName: string,
): LaneSessionRecord | null {
  const laneKey = buildLaneSessionKey(projectDir, worktreePath, worktreeName, profileName);
  return listLaneSessions(projectDir).find((record) => record.laneKey === laneKey) ?? null;
}

export function saveLaneSession(record: LaneSessionRecord): void {
  const canonicalProjectDir = ensureCanonicalProjectStorage(record.projectDir);
  const canonicalWorktreePath = resolveProjectRoot(record.worktreePath);
  const dir = getProjectMemoryDir(canonicalProjectDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sessionsPath = getProjectSessionsPath(canonicalProjectDir);
  const laneKey = buildLaneSessionKey(canonicalProjectDir, canonicalWorktreePath, record.worktreeName, record.profileName);
  const existing = listLaneSessions(canonicalProjectDir).filter((item) => item.laneKey !== laneKey);
  existing.push({
    ...record,
    laneKey,
    projectDir: canonicalProjectDir,
    worktreePath: canonicalWorktreePath,
  });
  existing.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  writeFileSync(sessionsPath, JSON.stringify({ sessions: existing }, null, 2));
  try {
    laneSessionsCache.set(sessionsPath, {
      mtimeMs: statSync(sessionsPath).mtimeMs,
      sessions: existing,
    });
  } catch {
    laneSessionsCache.delete(sessionsPath);
  }
}
