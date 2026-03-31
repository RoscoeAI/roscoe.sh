import React, { useEffect } from "react";
import { ensureHostedRelayClientId, loadRoscoeSettings, saveRoscoeSettings } from "../config.js";
import { cleanPhoneNumber } from "../notification-service.js";
import { getHostedRelayClient, refreshHostedRelaySession } from "../hosted-relay-client.js";
import { processInboundOperatorReplies, deliverQueuedOperatorMessages } from "../operator-wire.js";
import { SessionManagerService } from "../services/session-manager.js";
import { AppAction, SessionState } from "../types.js";

export function useHostedRelayWire(
  sessions: Map<string, SessionState>,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
) {
  useEffect(() => {
    const client = getHostedRelayClient();

    const syncConfig = () => {
      const settings = loadRoscoeSettings();
      const phone = cleanPhoneNumber(settings.notifications.phoneNumber);
      if (
        settings.notifications.deliveryMode !== "roscoe-hosted"
        || !phone
        || !settings.notifications.consentAcknowledged
        || !settings.notifications.hostedRelayAccessToken
        || settings.notifications.hostedRelayLinkedPhone !== phone
      ) {
        client.configure(null);
        return;
      }

      const expiresAt = settings.notifications.hostedRelayAccessTokenExpiresAt
        ? Date.parse(settings.notifications.hostedRelayAccessTokenExpiresAt)
        : 0;
      const shouldRefresh =
        Boolean(settings.notifications.hostedRelayRefreshToken)
        && Number.isFinite(expiresAt)
        && expiresAt > 0
        && expiresAt - Date.now() < 60_000;

      if (shouldRefresh) {
        void refreshHostedRelaySession(
          process.env.ROSCOE_RELAY_BASE_URL?.trim() || "https://roscoe.sh",
          settings.notifications.hostedRelayRefreshToken,
          ensureHostedRelayClientId(),
        ).then((result) => {
          if (!result.ok) {
            return;
          }
          const latest = loadRoscoeSettings();
          saveRoscoeSettings({
            ...latest,
            notifications: {
              ...latest.notifications,
              hostedRelayAccessToken: result.accessToken,
              hostedRelayAccessTokenExpiresAt: result.accessTokenExpiresAt,
              hostedRelayRefreshToken: result.refreshToken,
              hostedRelayLinkedPhone: result.phone,
              hostedRelayLinkedEmail: result.userEmail ?? latest.notifications.hostedRelayLinkedEmail,
            },
          });
        }).catch(() => {
          // best effort
        });
      }

      client.configure({
        enabled: true,
        baseUrl: process.env.ROSCOE_RELAY_BASE_URL?.trim() || "https://roscoe.sh",
        accessToken: settings.notifications.hostedRelayAccessToken,
        clientId: ensureHostedRelayClientId(),
      });
    };

    syncConfig();
    const interval = setInterval(syncConfig, 2000);
    const unsubscribe = client.subscribe((message) => {
      void processInboundOperatorReplies({
        replies: [{
          id: message.id,
          body: message.body,
          answerText: message.body,
          from: message.fromPhone,
          receivedAt: Date.parse(message.receivedAt),
          via: "hosted-sms",
        }],
        sessions,
        dispatch,
        service,
        provider: "roscoe-relay",
        toolName: "hosted-sms",
        sourceLabel: "Hosted SMS",
      }).then(() => {
        client.ackInbound([message.id]);
      });
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [dispatch, service, sessions]);

  useEffect(() => {
    const settings = loadRoscoeSettings();
    if (settings.notifications.deliveryMode !== "roscoe-hosted") {
      return;
    }
    deliverQueuedOperatorMessages(
      sessions,
      dispatch,
      service,
      "roscoe-relay",
      "hosted-sms",
      "Hosted SMS",
    );
  }, [sessions, dispatch, service]);
}
