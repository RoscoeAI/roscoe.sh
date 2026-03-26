import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let enabled = false;
let logPath = "";

export function enableDebug(): void {
  enabled = true;
  const dir = join(homedir(), ".roscoe");
  mkdirSync(dir, { recursive: true });
  logPath = join(dir, "debug.log");
  appendFileSync(logPath, `\n--- session ${new Date().toISOString()} ---\n`);
}

export function isDebug(): boolean {
  return enabled;
}

export function dbg(label: string, ...args: unknown[]): void {
  if (!enabled) return;
  const ts = new Date().toISOString().slice(11, 23);
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  appendFileSync(logPath, `[${ts}] [${label}] ${msg}\n`);
}
