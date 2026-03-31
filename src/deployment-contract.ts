import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export type DeploymentContractMode =
  | "inferred-existing"
  | "planned-greenfield"
  | "defer"
  | "not-applicable";

export interface DeploymentContract {
  mode: DeploymentContractMode;
  summary: string;
  artifactType: string;
  platforms: string[];
  environments: string[];
  buildSteps: string[];
  deploySteps: string[];
  previewStrategy: string[];
  presenceStrategy: string[];
  proofTargets: string[];
  healthChecks: string[];
  rollback: string[];
  requiredSecrets: string[];
}

export interface DeploymentAssessment {
  mode: DeploymentContractMode;
  summary: string;
  signals: string[];
  artifactType: string;
  platforms: string[];
  environments: string[];
  buildSteps: string[];
  deploySteps: string[];
  previewStrategy: string[];
  presenceStrategy: string[];
  proofTargets: string[];
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
  bin?: string | Record<string, string>;
}

const PLATFORM_FILES: Array<{
  file: string;
  platform: string;
  artifactType?: string;
  previewStrategy?: string;
  deployHint?: string;
}> = [
  {
    file: "wrangler.toml",
    platform: "Cloudflare",
    artifactType: "edge app or worker",
    previewStrategy: "Use the existing Cloudflare preview workflow if configured.",
    deployHint: "Use the existing wrangler or Cloudflare deployment path already in the repo.",
  },
  {
    file: "vercel.json",
    platform: "Vercel",
    artifactType: "web app",
    previewStrategy: "Use the repo's Vercel preview deployments if they are already wired.",
    deployHint: "Use the repo's existing Vercel deployment path rather than adding a new platform.",
  },
  {
    file: "netlify.toml",
    platform: "Netlify",
    artifactType: "web app",
    previewStrategy: "Use the repo's Netlify preview or deploy-preview flow if present.",
    deployHint: "Use the existing Netlify deployment path rather than inventing a new one.",
  },
  {
    file: "fly.toml",
    platform: "Fly.io",
    artifactType: "service",
    deployHint: "Use the repo's Fly.io deployment flow.",
  },
  {
    file: "render.yaml",
    platform: "Render",
    artifactType: "service",
    deployHint: "Use the repo's Render deployment flow.",
  },
  {
    file: "Dockerfile",
    platform: "Docker",
    artifactType: "service",
    deployHint: "Build the existing container image path before inventing another deploy shape.",
  },
  {
    file: "docker-compose.yml",
    platform: "Docker Compose",
    artifactType: "service",
    deployHint: "Preserve the repo's existing container orchestration path.",
  },
  {
    file: "docker-compose.yaml",
    platform: "Docker Compose",
    artifactType: "service",
    deployHint: "Preserve the repo's existing container orchestration path.",
  },
];

const KNOWN_WEB_MARKERS = [
  "vercel.json",
  "netlify.toml",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.ts",
  "src/app",
  "src/pages",
  "app",
  "pages",
  "public",
  "index.html",
];

const KNOWN_SERVICE_MARKERS = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "server",
  "api",
  "src/server",
  "src/api",
];

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function unique(items: string[]): string[] {
  return items.filter((item, index) => items.indexOf(item) === index);
}

function listTopLevelEntries(projectDir: string): Set<string> {
  try {
    return new Set(readdirSync(projectDir));
  } catch {
    return new Set<string>();
  }
}

function readPackageJson(projectDir: string): PackageJsonShape | null {
  const path = join(projectDir, "package.json");
  const topLevelEntries = listTopLevelEntries(projectDir);
  if (!topLevelEntries.has("package.json") || !existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PackageJsonShape;
  } catch {
    return null;
  }
}

function hasAnyPath(projectDir: string, paths: string[]): boolean {
  const topLevelEntries = listTopLevelEntries(projectDir);
  return paths.some((entry) => {
    if (!entry.includes("/")) {
      return topLevelEntries.has(entry) && existsSync(join(projectDir, entry));
    }
    const [root] = entry.split("/");
    if (!root || !topLevelEntries.has(root)) {
      return false;
    }
    return existsSync(join(projectDir, entry));
  });
}

function readWorkflowSignals(projectDir: string): string[] {
  const workflowsDir = join(projectDir, ".github", "workflows");
  if (!existsSync(workflowsDir)) return [];

  try {
    return readdirSync(workflowsDir)
      .filter((name) => /\.(ya?ml)$/i.test(name))
      .filter((name) => /(deploy|release|publish|preview)/i.test(name))
      .map((name) => `.github/workflows/${name}`);
  } catch {
    return [];
  }
}

function inferArtifactType(projectDir: string, pkg: PackageJsonShape | null, platforms: string[]): string {
  if (pkg?.bin && (typeof pkg.bin === "string" || Object.keys(pkg.bin).length > 0)) {
    return "CLI/package";
  }
  if (platforms.includes("Cloudflare")) {
    return "edge app or worker";
  }
  if (hasAnyPath(projectDir, KNOWN_WEB_MARKERS)) {
    return "web app";
  }
  if (hasAnyPath(projectDir, KNOWN_SERVICE_MARKERS)) {
    return "service";
  }
  return "";
}

function inferFromScripts(pkg: PackageJsonShape | null): {
  signals: string[];
  buildSteps: string[];
  deploySteps: string[];
  previewStrategy: string[];
  environments: string[];
} {
  const scripts = pkg?.scripts ?? {};
  const signals: string[] = [];
  const buildSteps: string[] = [];
  const deploySteps: string[] = [];
  const previewStrategy: string[] = [];
  const environments = new Set<string>();

  if (typeof scripts.build === "string" && scripts.build.trim()) {
    buildSteps.push("npm run build");
    signals.push("package.json:scripts.build");
  }

  if (typeof scripts.deploy === "string" && scripts.deploy.trim()) {
    deploySteps.push("npm run deploy");
    environments.add("production");
    signals.push("package.json:scripts.deploy");
  }

  if (typeof scripts.release === "string" && scripts.release.trim()) {
    deploySteps.push("npm run release");
    environments.add("production");
    signals.push("package.json:scripts.release");
  }

  if (typeof scripts.preview === "string" && scripts.preview.trim()) {
    previewStrategy.push("npm run preview");
    environments.add("preview");
    signals.push("package.json:scripts.preview");
  }

  if (typeof scripts.start === "string" && scripts.start.trim()) {
    signals.push("package.json:scripts.start");
  }

  return {
    signals,
    buildSteps,
    deploySteps,
    previewStrategy,
    environments: Array.from(environments),
  };
}

function inferPresenceExpectations(
  artifactType: string,
  platforms: string[],
  environments: string[],
): {
  presenceStrategy: string[];
  proofTargets: string[];
} {
  const normalizedArtifact = artifactType.toLowerCase();
  const webFacing = normalizedArtifact.includes("web") || normalizedArtifact.includes("edge app");
  if (!webFacing) {
    return {
      presenceStrategy: [],
      proofTargets: [],
    };
  }

  const presenceStrategy = unique([
    environments.includes("preview") || platforms.length > 0
      ? "Keep a truthful non-local web presence live through preview or staging as milestones land; do not wait until the final launch to prove the hosted experience."
      : "Define the first truthful non-local web presence before calling hosted milestones done.",
    platforms.includes("Vercel")
      ? "Use the repo's Vercel preview deployment as the continuously updated hosted proof surface."
      : "",
    platforms.includes("Cloudflare")
      ? "Use the repo's Cloudflare preview or staged worker URL as the continuously updated hosted proof surface."
      : "",
    platforms.includes("Netlify")
      ? "Use the repo's Netlify deploy preview as the continuously updated hosted proof surface."
      : "",
  ].filter(Boolean));

  const proofTargets = unique([
    environments.includes("preview") ? "An operator-openable preview or staging URL must exist while the product is still evolving." : "",
    environments.includes("production") ? "The production domain or cutover URL must be explicit before Roscoe treats deployment as closed." : "",
    platforms.length > 0 ? `Hosted proof should follow the repo's existing platform story: ${platforms.join(", ")}.` : "",
  ].filter(Boolean));

  return {
    presenceStrategy,
    proofTargets,
  };
}

function buildDeferredAssessment(reason: string): DeploymentAssessment {
  return {
    mode: "defer",
    summary: reason,
    signals: [],
    artifactType: "",
    platforms: [],
    environments: [],
    buildSteps: [],
    deploySteps: [],
    previewStrategy: [],
    presenceStrategy: [],
    proofTargets: [],
  };
}

export function inferDeploymentAssessment(projectDir: string | undefined | null): DeploymentAssessment {
  if (!projectDir || !existsSync(projectDir)) {
    return buildDeferredAssessment(
      "Deployment is not locked yet. Roscoe should define or infer the deploy path later before mutating environments.",
    );
  }

  const topLevelEntries = listTopLevelEntries(projectDir);
  const pkg = readPackageJson(projectDir);
  const scriptSignals = inferFromScripts(pkg);
  const workflowSignals = readWorkflowSignals(projectDir);
  const platformSignals = PLATFORM_FILES.filter((entry) =>
    topLevelEntries.has(entry.file) && existsSync(join(projectDir, entry.file)),
  );

  const signals = unique([
    ...platformSignals.map((entry) => entry.file),
    ...workflowSignals,
    ...scriptSignals.signals,
  ]);

  const platforms = unique(platformSignals.map((entry) => entry.platform));
  const artifactType = inferArtifactType(projectDir, pkg, platforms);
  const previewStrategy = unique([
    ...scriptSignals.previewStrategy,
    ...platformSignals
      .map((entry) => entry.previewStrategy)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
  ]);
  const deploySteps = unique([
    ...scriptSignals.deploySteps,
    ...platformSignals
      .map((entry) => entry.deployHint)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
    ...workflowSignals.map((entry) => `Use the existing ${entry} workflow.`),
  ]);
  const buildSteps = unique(scriptSignals.buildSteps);
  const environments = unique([
    ...scriptSignals.environments,
    ...(previewStrategy.length > 0 ? ["preview"] : []),
    ...(deploySteps.length > 0 || workflowSignals.length > 0 || platforms.length > 0 ? ["production"] : []),
  ]);
  const presenceExpectations = inferPresenceExpectations(artifactType, platforms, environments);

  if (signals.length === 0) {
    return buildDeferredAssessment(
      "No canonical deployment path was detected yet. Roscoe should ask or infer deployment later before wiring infrastructure.",
    );
  }

  const summaryParts = [
    platforms.length > 0 ? `Existing deploy patterns detected: ${platforms.join(", ")}` : "Existing deploy signals detected",
    signals.length > 0 ? `Signals: ${signals.join(", ")}` : "",
    "Roscoe should lean into these existing patterns instead of inventing a new deployment stack.",
  ].filter(Boolean);

  return {
    mode: "inferred-existing",
    summary: `${summaryParts.join(". ")}.`,
    signals,
    artifactType,
    platforms,
    environments,
    buildSteps,
    deploySteps,
    previewStrategy,
    presenceStrategy: presenceExpectations.presenceStrategy,
    proofTargets: presenceExpectations.proofTargets,
  };
}

function defaultDeploymentContract(projectDir: string | undefined): DeploymentContract {
  const inferred = inferDeploymentAssessment(projectDir);
  return {
    mode: inferred.mode,
    summary: inferred.summary,
    artifactType: inferred.artifactType,
    platforms: inferred.platforms,
    environments: inferred.environments,
    buildSteps: inferred.buildSteps,
    deploySteps: inferred.deploySteps,
    previewStrategy: inferred.previewStrategy,
    presenceStrategy: inferred.presenceStrategy,
    proofTargets: inferred.proofTargets,
    healthChecks: [],
    rollback: [],
    requiredSecrets: [],
  };
}

export function normalizeDeploymentContract(
  projectDir: string | undefined,
  value: unknown,
): DeploymentContract {
  const typed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const fallback = defaultDeploymentContract(projectDir);
  const requestedMode = typed.mode;
  const mode: DeploymentContractMode =
    requestedMode === "inferred-existing"
      || requestedMode === "planned-greenfield"
      || requestedMode === "defer"
      || requestedMode === "not-applicable"
      ? requestedMode
      : fallback.mode;

  const summary = typeof typed.summary === "string" && typed.summary.trim().length > 0
    ? typed.summary.trim()
    : fallback.summary;

  return {
    mode,
    summary,
    artifactType: typeof typed.artifactType === "string" ? typed.artifactType : fallback.artifactType,
    platforms: normalizeStringArray(typed.platforms).length > 0
      ? normalizeStringArray(typed.platforms)
      : fallback.platforms,
    environments: normalizeStringArray(typed.environments).length > 0
      ? normalizeStringArray(typed.environments)
      : fallback.environments,
    buildSteps: normalizeStringArray(typed.buildSteps).length > 0
      ? normalizeStringArray(typed.buildSteps)
      : fallback.buildSteps,
    deploySteps: normalizeStringArray(typed.deploySteps).length > 0
      ? normalizeStringArray(typed.deploySteps)
      : fallback.deploySteps,
    previewStrategy: normalizeStringArray(typed.previewStrategy).length > 0
      ? normalizeStringArray(typed.previewStrategy)
      : fallback.previewStrategy,
    presenceStrategy: normalizeStringArray(typed.presenceStrategy).length > 0
      ? normalizeStringArray(typed.presenceStrategy)
      : fallback.presenceStrategy,
    proofTargets: normalizeStringArray(typed.proofTargets).length > 0
      ? normalizeStringArray(typed.proofTargets)
      : fallback.proofTargets,
    healthChecks: normalizeStringArray(typed.healthChecks),
    rollback: normalizeStringArray(typed.rollback),
    requiredSecrets: normalizeStringArray(typed.requiredSecrets),
  };
}
