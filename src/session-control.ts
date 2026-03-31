import { SessionState } from "./types.js";

export function getResumePrompt(session: SessionState): string {
  if (session.status === "blocked") {
    return "Resume this lane from the current blocked state. First verify whether the blocker is actually cleared. If it is still blocked, report the blocker once and stay paused. If it is clear, continue the next concrete step and report back normally.";
  }

  if (session.status === "parked") {
    return "Resume this lane and pick up the next concrete slice from where you left off.";
  }

  return "Continue your work from where you left off.";
}
