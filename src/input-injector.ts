import { SessionMonitor } from "./session-monitor.js";

export class InputInjector {
  inject(session: SessionMonitor, text: string): void {
    if (session.getSessionId()) {
      // Subsequent turn — resume existing conversation
      session.sendFollowUp(text);
    } else {
      // First turn — start a new conversation
      session.startTurn(text);
    }
  }
}
