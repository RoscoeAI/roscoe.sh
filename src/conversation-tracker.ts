export interface Message {
  role: "assistant" | "user" | "system";
  content: string;
  timestamp: number;
}

export class ConversationTracker {
  private messages: Message[] = [];
  private pendingOutput = "";

  addOutput(text: string): void {
    this.pendingOutput += text;
  }

  markTurnComplete(): void {
    if (this.pendingOutput.trim()) {
      this.messages.push({
        role: "assistant",
        content: this.pendingOutput.trim(),
        timestamp: Date.now(),
      });
      this.pendingOutput = "";
    }
  }

  recordUserInput(text: string): void {
    this.messages.push({
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    });
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  getRecentHistory(maxMessages = 20): Message[] {
    return this.messages.slice(-maxMessages);
  }

  getLastAssistantMessage(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") {
        return this.messages[i].content;
      }
    }
    return null;
  }

  getContextForGeneration(): string {
    const recent = this.getRecentHistory();
    return recent
      .map((m) => {
        const role = m.role === "assistant" ? "LLM" : "User";
        return `${role}: ${m.content}`;
      })
      .join("\n\n");
  }
}
