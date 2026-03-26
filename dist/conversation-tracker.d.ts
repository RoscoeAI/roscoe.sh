export interface Message {
    role: "assistant" | "user" | "system";
    content: string;
    timestamp: number;
}
export declare class ConversationTracker {
    private messages;
    private pendingOutput;
    addOutput(text: string): void;
    markTurnComplete(): void;
    recordUserInput(text: string): void;
    getHistory(): Message[];
    getRecentHistory(maxMessages?: number): Message[];
    getLastAssistantMessage(): string | null;
    getContextForGeneration(): string;
}
