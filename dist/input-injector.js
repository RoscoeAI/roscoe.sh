export class InputInjector {
    inject(session, text) {
        if (session.getSessionId()) {
            // Subsequent turn — resume existing conversation
            session.sendFollowUp(text);
        }
        else {
            // First turn — start a new conversation
            session.startTurn(text);
        }
    }
}
