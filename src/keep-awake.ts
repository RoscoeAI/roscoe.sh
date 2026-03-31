import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";

let keepAwakeProcess: ChildProcess | null = null;

export function isRoscoeKeepAwakeSupported(): boolean {
  return process.platform === "darwin"
    && process.env.NODE_ENV !== "test"
    && existsSync("/usr/bin/caffeinate");
}

function clearKeepAwakeProcess(processRef: ChildProcess): void {
  if (keepAwakeProcess === processRef) {
    keepAwakeProcess = null;
  }
}

function startKeepAwake(): void {
  if (!isRoscoeKeepAwakeSupported() || keepAwakeProcess) {
    return;
  }

  const child = spawn("/usr/bin/caffeinate", ["-dimsu", "-w", String(process.pid)], {
    stdio: "ignore",
  });

  child.on("exit", () => {
    clearKeepAwakeProcess(child);
  });
  child.on("error", () => {
    clearKeepAwakeProcess(child);
  });
  child.unref();
  keepAwakeProcess = child;
}

function stopKeepAwake(): void {
  if (!keepAwakeProcess) {
    return;
  }

  keepAwakeProcess.kill("SIGTERM");
  keepAwakeProcess = null;
}

export function setRoscoeKeepAwakeEnabled(enabled: boolean): void {
  if (enabled) {
    startKeepAwake();
    return;
  }

  stopKeepAwake();
}

export function resetRoscoeKeepAwakeForTests(): void {
  stopKeepAwake();
}
