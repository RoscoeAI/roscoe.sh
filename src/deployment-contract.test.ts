import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { inferDeploymentAssessment, normalizeDeploymentContract } from "./deployment-contract.js";

describe("deployment-contract", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("infers an existing deployment pattern from repo files and scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-"));
    dirs.push(dir);

    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "app",
      scripts: {
        build: "vite build",
        deploy: "wrangler deploy",
        preview: "vite preview",
      },
    }));
    writeFileSync(join(dir, "wrangler.toml"), "name = \"app\"\n");
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "deploy.yml"), "name: deploy\n");

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("inferred-existing");
    expect(result.platforms).toContain("Cloudflare");
    expect(result.buildSteps).toContain("npm run build");
    expect(result.deploySteps.join(" ")).toContain("wrangler");
    expect(result.previewStrategy.join(" ")).toContain("preview");
    expect(result.presenceStrategy.join(" ")).toContain("hosted");
    expect(result.proofTargets.join(" ")).toContain("URL");
    expect(result.environments).toEqual(expect.arrayContaining(["preview", "production"]));
  });

  it("defaults to a deferred deployment contract when the workspace is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-empty-"));
    dirs.push(dir);

    const result = normalizeDeploymentContract(dir, undefined);

    expect(result.mode).toBe("defer");
    expect(result.summary.toLowerCase()).toContain("deployment");
    expect(result.deploySteps).toEqual([]);
    expect(result.presenceStrategy).toEqual([]);
    expect(result.proofTargets).toEqual([]);
  });

  it("returns a deferred assessment when the package json is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-invalid-"));
    dirs.push(dir);

    writeFileSync(join(dir, "package.json"), "{invalid json");

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("defer");
    expect(result.summary.toLowerCase()).toContain("canonical deployment path");
  });

  it("infers CLI/package repos without adding hosted proof expectations", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-cli-"));
    dirs.push(dir);

    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "roscoe-cli",
      bin: {
        roscoe: "bin/roscoe.js",
      },
      scripts: {
        build: "tsup src/index.ts",
        release: "npm publish",
      },
    }));

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("inferred-existing");
    expect(result.artifactType).toBe("CLI/package");
    expect(result.presenceStrategy).toEqual([]);
    expect(result.proofTargets).toEqual([]);
    expect(result.deploySteps).toContain("npm run release");
    expect(result.environments).toContain("production");
  });

  it("infers a service deployment path from service markers and production-only presence expectations", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-service-"));
    dirs.push(dir);

    mkdirSync(join(dir, "api"), { recursive: true });
    writeFileSync(join(dir, "api", "server.ts"), "export {};\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "svc",
      scripts: {
        start: "node api/server.js",
        release: "docker push svc",
      },
    }));
    writeFileSync(join(dir, "Dockerfile"), "FROM node:20\n");

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("inferred-existing");
    expect(result.artifactType).toBe("service");
    expect(result.platforms).toContain("Docker");
    expect(result.deploySteps.join(" ")).toContain("container");
    expect(result.previewStrategy).toEqual([]);
    expect(result.presenceStrategy).toEqual([]);
    expect(result.proofTargets).toEqual([]);
  });

  it("normalizes explicit deployment contracts while falling back missing arrays", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-web-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "web-app",
      scripts: {
        build: "vite build",
        preview: "vite preview",
      },
    }));
    writeFileSync(join(dir, "vercel.json"), "{}");

    const result = normalizeDeploymentContract(dir, {
      mode: "planned-greenfield",
      summary: "Deploy to a preview stack before production.",
      artifactType: "custom web app",
      platforms: [],
      environments: [],
      buildSteps: [],
      deploySteps: ["pnpm deploy:preview"],
      previewStrategy: [],
      presenceStrategy: ["Keep staging live."],
      proofTargets: [],
      healthChecks: ["GET /health returns 200"],
      rollback: ["Redeploy the previous image"],
      requiredSecrets: ["FLY_API_TOKEN"],
    });

    expect(result.mode).toBe("planned-greenfield");
    expect(result.summary).toBe("Deploy to a preview stack before production.");
    expect(result.artifactType).toBe("custom web app");
    expect(result.deploySteps).toEqual(["pnpm deploy:preview"]);
    expect(result.platforms).toContain("Vercel");
    expect(result.environments).toContain("preview");
    expect(result.previewStrategy.join(" ")).toContain("preview");
    expect(result.presenceStrategy).toEqual(["Keep staging live."]);
    expect(result.proofTargets.join(" ")).toContain("URL");
    expect(result.healthChecks).toEqual(["GET /health returns 200"]);
    expect(result.rollback).toEqual(["Redeploy the previous image"]);
    expect(result.requiredSecrets).toEqual(["FLY_API_TOKEN"]);
  });

  it("keeps explicitly provided deployment arrays when they are non-empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-explicit-"));
    dirs.push(dir);

    const result = normalizeDeploymentContract(dir, {
      mode: "not-applicable",
      summary: "Deployment is handled externally.",
      artifactType: "custom service",
      platforms: ["Custom host"],
      environments: ["preview"],
      buildSteps: ["pnpm build:preview"],
      deploySteps: ["pnpm deploy:preview"],
      previewStrategy: ["Use the operator preview URL"],
      presenceStrategy: ["Keep a hosted stage visible while iterating"],
      proofTargets: ["https://stage.example.com"],
      healthChecks: ["GET /health"],
      rollback: ["Redeploy previous artifact"],
      requiredSecrets: ["HOST_TOKEN"],
    });

    expect(result.mode).toBe("not-applicable");
    expect(result.platforms).toEqual(["Custom host"]);
    expect(result.environments).toEqual(["preview"]);
    expect(result.buildSteps).toEqual(["pnpm build:preview"]);
    expect(result.previewStrategy).toEqual(["Use the operator preview URL"]);
    expect(result.presenceStrategy).toEqual(["Keep a hosted stage visible while iterating"]);
    expect(result.proofTargets).toEqual(["https://stage.example.com"]);
  });

  it("falls back malformed deployment contracts to inferred defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-fallback-"));
    dirs.push(dir);

    mkdirSync(join(dir, "src", "app"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "web-app",
      scripts: {
        build: "vite build",
        start: "vite dev",
      },
    }));
    writeFileSync(join(dir, "vercel.json"), "{}");

    const result = normalizeDeploymentContract(dir, {
      mode: "bogus",
      summary: "   ",
      artifactType: 42,
      platforms: [""],
      environments: [""],
      buildSteps: [""],
      deploySteps: [""],
      previewStrategy: [""],
      presenceStrategy: [""],
      proofTargets: [""],
      healthChecks: ["", "GET /health"],
      rollback: ["rollback"],
      requiredSecrets: ["", "TOKEN"],
    });

    expect(result.mode).toBe("inferred-existing");
    expect(result.summary).toContain("Existing deploy");
    expect(result.artifactType).toBe("web app");
    expect(result.platforms).toContain("Vercel");
    expect(result.environments).toContain("production");
    expect(result.buildSteps).toContain("npm run build");
    expect(result.previewStrategy.join(" ")).toContain("preview");
    expect(result.presenceStrategy.join(" ")).toContain("hosted");
    expect(result.proofTargets.join(" ")).toContain("production");
    expect(result.healthChecks).toEqual(["GET /health"]);
    expect(result.rollback).toEqual(["rollback"]);
    expect(result.requiredSecrets).toEqual(["TOKEN"]);
  });

  it("does not treat an empty bin object as a CLI package and omits hosted proof when no platform or environment exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-web-lite-"));
    dirs.push(dir);

    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "web-lite",
      bin: {},
    }));
    writeFileSync(join(dir, "index.html"), "<!doctype html><html></html>");

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("defer");
    expect(result.artifactType).toBe("");
    expect(result.presenceStrategy).toEqual([]);
    expect(result.proofTargets).toEqual([]);
  });

  it("infers non-platform web presence expectations without a preview environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-web-no-preview-"));
    dirs.push(dir);

    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "web-lite",
      scripts: {
        start: "node server.js",
      },
    }));
    writeFileSync(join(dir, "index.html"), "<!doctype html><html></html>");

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("inferred-existing");
    expect(result.artifactType).toBe("web app");
    expect(result.platforms).toEqual([]);
    expect(result.environments).toEqual([]);
    expect(result.presenceStrategy.join(" ")).toContain("first truthful non-local web presence");
    expect(result.proofTargets).toEqual([]);
  });

  it("infers Netlify deploy previews as hosted proof", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-deploy-netlify-"));
    dirs.push(dir);

    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "netlify-app",
      scripts: {
        build: "vite build",
      },
    }));
    writeFileSync(join(dir, "netlify.toml"), "[build]\n");

    const result = inferDeploymentAssessment(dir);

    expect(result.mode).toBe("inferred-existing");
    expect(result.platforms).toContain("Netlify");
    expect(result.presenceStrategy.join(" ")).toContain("Netlify deploy preview");
    expect(result.proofTargets.join(" ")).toContain("production domain");
  });
});
