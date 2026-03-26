# Roscoe.sh Site

This folder contains the standalone marketing + compliance site for `roscoe.sh`.

Current status:
- Brand kit defined
- Visual board defined
- Twilio messaging program copy defined
- Vite + React client implemented
- Express consent API implemented
- Kubernetes + GitHub Actions deploy assets added

Local commands:
- `npm install`
- `npm run dev`
- `npm run lint`
- `npm run test`
- `npm run build`

Checkpoint artifacts:
- `brand/roscoe-brand-kit.md`
- `brand/roscoe-visual-board.html`
- `brand/twilio-program-brief.md`
- `TWILIO_SUBMISSION.md`

Runtime routes:
- `/`
- `/sms-consent`
- `/privacy`
- `/terms`
- `/healthz`

Environment variables:
- `ROSCOE_SITE_DATABASE_URL`
- `ROSCOE_SITE_BASE_URL`
- `ROSCOE_SITE_SUPPORT_EMAIL`
- `PORT`

Deploy assets:
- `Dockerfile`
- `k3/prod.yml`
- `k3/cert-manager.yml`
- `.github/workflows/deploy-roscoe-site-k3.yml`
