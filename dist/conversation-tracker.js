export class ConversationTracker {
    messages = [];
    pendingOutput = "";
    addOutput(text) {
        this.pendingOutput += text;
    }
    markTurnComplete() {
        if (this.pendingOutput.trim()) {
            this.messages.push({
                role: "assistant",
                content: this.pendingOutput.trim(),
                timestamp: Date.now(),
            });
            this.pendingOutput = "";
        }
    }
    recordUserInput(text) {
        this.messages.push({
            role: "user",
            content: text.trim(),
            timestamp: Date.now(),
        });
    }
    getHistory() {
        return [...this.messages];
    }
    getRecentHistory(maxMessages = 20) {
        return this.messages.slice(-maxMessages);
    }
    getLastAssistantMessage() {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === "assistant") {
                return this.messages[i].content;
            }
        }
        return null;
    }
    getContextForGeneration() {
        const recent = this.getRecentHistory();
        return recent
            .map((m) => {
            const role = m.role === "assistant" ? "LLM" : "User";
            return `${role}: ${m.content}`;
        })
            .join("\n\n");
    }
}
