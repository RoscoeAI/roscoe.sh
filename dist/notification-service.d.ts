import { ManagedSession } from "./types.js";
export interface NotificationStatus {
    enabled: boolean;
    phoneNumber: string;
    provider: "twilio";
    providerReady: boolean;
    summary: string;
    inboundMode: "poll" | "webhook";
    inboundDetail: string;
}
interface ProgressEstimate {
    percent: number;
    rationale: string;
}
type TwilioMessageStatus = "accepted" | "scheduled" | "canceled" | "queued" | "sending" | "sent" | "failed" | "delivered" | "undelivered" | "receiving" | "received" | "read";
type SmsInboundTransportPreference = "auto" | "poll" | "webhook";
interface SmsWebhookConfig {
    requestedMode: SmsInboundTransportPreference;
    effectiveMode: "poll" | "webhook";
    detail: string;
    port: number;
    path: string;
    publicUrl: string | null;
    validateSignature: boolean;
}
export interface SmsSendResult {
    ok: boolean;
    accepted: boolean;
    delivered: boolean;
    status: TwilioMessageStatus | "unknown";
    sid?: string;
    errorCode?: number | null;
    errorMessage?: string | null;
    detail: string;
}
export interface SmsQuestionResult extends SmsSendResult {
    token: string;
    prompt: string;
    renderedQuestion: string;
}
export interface IncomingSmsReply {
    sid: string;
    body: string;
    answerText: string;
    from: string;
    to?: string;
    receivedAt: number;
    token?: string;
    matchedSessionId?: string;
    matchedQuestion?: string;
}
declare function cleanPhoneNumber(value: string): string;
declare function extractUrls(text: string): string[];
declare function estimateProgress(summary: string, transcript: string): ProgressEstimate;
declare function readWebhookConfig(): SmsWebhookConfig;
export declare class NotificationService {
    private lastSentBySession;
    private pendingQuestions;
    private seenInboundSids;
    private webhookReplies;
    private webhookServer;
    private webhookStartError;
    private webhookListeningPort;
    hasPendingQuestions(): boolean;
    getInboundTransport(): {
        mode: "poll" | "webhook";
        detail: string;
        listeningPort?: number | null;
        publicUrl?: string | null;
    };
    getStatus(): NotificationStatus;
    ensureInboundTransportReady(): Promise<void>;
    shutdown(): Promise<void>;
    readIncomingReplies(): Promise<IncomingSmsReply[]>;
    sendTestMessage(): Promise<SmsSendResult>;
    maybeSendProgressUpdate(session: ManagedSession, summary: string): Promise<boolean>;
    sendQuestion(session: ManagedSession, question: string): Promise<SmsQuestionResult>;
    private pollIncomingReplies;
    private sendSms;
    private pollForFinalStatus;
    private fetchMessage;
    private handleWebhookRequest;
    private readRequestBody;
    private drainWebhookReplies;
    private markReplyConsumed;
    private isTerminalStatus;
    private buildSendResult;
    private createQuestionToken;
    private mapInboundReply;
}
export { cleanPhoneNumber, estimateProgress, extractUrls, readWebhookConfig };
