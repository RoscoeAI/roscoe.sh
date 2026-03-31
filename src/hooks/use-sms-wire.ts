import React, { useEffect, useRef } from "react";
import { loadRoscoeSettings } from "../config.js";
import { processInboundOperatorReplies, deliverQueuedOperatorMessages, InboundOperatorReply } from "../operator-wire.js";
import { SessionManagerService } from "../services/session-manager.js";
import { AppAction, SessionState } from "../types.js";

export function useSmsWire(
  sessions: Map<string, SessionState>,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
) {
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const interval = setInterval(() => {
      const settings = loadRoscoeSettings();
      if (settings.notifications.deliveryMode === "roscoe-hosted") {
        return;
      }

      const smsStatus = service.notifications.getStatus();
      if ((!smsStatus.enabled && !service.notifications.hasPendingQuestions()) || !smsStatus.providerReady || !smsStatus.phoneNumber) {
        return;
      }

      void service.notifications.readIncomingReplies()
        .then(async (replies) => {
          const normalizedReplies: InboundOperatorReply[] = replies.map((reply) => ({
            id: reply.sid,
            body: reply.body,
            answerText: reply.answerText,
            from: reply.from,
            receivedAt: reply.receivedAt,
            token: reply.token,
            matchedSessionId: reply.matchedSessionId,
            via: "sms",
          }));
          await processInboundOperatorReplies({
            replies: normalizedReplies,
            sessions: sessionsRef.current,
            dispatch,
            service,
            provider: "twilio",
            toolName: "sms",
            sourceLabel: "SMS",
          });
        })
        .catch(() => {
          // Best-effort inbox polling; never interrupt Roscoe because Twilio is unavailable.
        });
    }, 5000);

    return () => clearInterval(interval);
  }, [dispatch, service]);

  useEffect(() => {
    const settings = loadRoscoeSettings();
    if (settings.notifications.deliveryMode === "roscoe-hosted") {
      return;
    }
    deliverQueuedOperatorMessages(
      sessions,
      dispatch,
      service,
      "twilio",
      "sms",
      "SMS",
    );
  }, [sessions, dispatch, service]);
}
