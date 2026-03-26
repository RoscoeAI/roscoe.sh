import { Link, Route, Routes } from "react-router-dom";
import {
  consentCategories,
  consentDisclosure,
  privacyDisclosure,
  programDescription,
  sampleMessages,
} from "../shared/program";
import { ConsentForm } from "./components/ConsentForm";

const repoUrl = "https://github.com/K12io/roscoe.sh";

const commandDeck = [
  "npm install -g roscoe",
  "roscoe onboard /path/to/project",
  "roscoe start codex@/path/to/project",
];

const productSignals = [
  "Monitors Claude Code and Codex sessions side by side",
  "Drafts replies with confidence scoring and human override",
  "Texts you when a Guild lane needs a real decision",
];

const workflowMoments = [
  {
    title: "Watch the wire",
    body: "Roscoe reads the live CLI transcript, intent brief, and proof expectations before it drafts anything back.",
  },
  {
    title: "Answer with judgment",
    body: "Guild workers keep moving until Roscoe decides a reply is safe to send, asks you for approval, or texts for a missing decision.",
  },
  {
    title: "Prove done",
    body: "The loop stays tied to tests, coverage, and transcript evidence so ‘done’ means the code, the proof, and the operator all agree.",
  },
];

const developerPillars = [
  {
    label: "Open source",
    detail: "Apache 2.0 licensed so teams can inspect, fork, and adapt the operator loop.",
  },
  {
    label: "CLI-native",
    detail: "Built around real Claude and Codex CLI sessions rather than a fake chat abstraction.",
  },
  {
    label: "Human-in-the-loop",
    detail: "Roscoe can auto-run, pause for approval, or escalate to SMS when a lane needs a real answer.",
  },
];

function SiteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <header className="masthead">
        <Link className="brandmark" to="/">ROSCOE</Link>
        <nav className="topnav">
          <a href="/#getting-started">Getting started</a>
          <Link to="/docs">Docs</Link>
          <a href="/#open-source">Open source</a>
          <Link to="/sms-consent">SMS Consent</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </header>
      {children}
      <footer className="footer">
        <span>Roscoe rides the wire for Claude & Codex.</span>
        <span>Transactional SMS only. No marketing.</span>
      </footer>
    </div>
  );
}

function HeroScene() {
  return (
    <div className="hero-plate" aria-hidden="true">
      <div className="plate-grid"></div>
      <div className="plate-glow"></div>
      <div className="signal-lines">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div className="terminal-sheet">
        <div className="sheet-header">
          <span>ROSCOE</span>
          <span>LIVE AUTOPILOT</span>
        </div>
        <div className="sheet-row">
          <span className="sheet-label">REMOTE</span>
          <span className="sheet-value">Codex traced the payment flow and found the failing edge.</span>
        </div>
        <div className="sheet-row">
          <span className="sheet-label">ROSCOE</span>
          <span className="sheet-value">High confidence. Ship the proof patch, rerun e2e, then send the status wire.</span>
        </div>
        <div className="sheet-row">
          <span className="sheet-label">STATUS</span>
          <span className="sheet-value">Tests-first · human-ready · confidence 92</span>
        </div>
      </div>
      <div className="telegraph-rings">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <SiteFrame>
      <main>
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">CLI Autopilot</p>
              <h1>Roscoe runs the reply loop for Claude Code and Codex.</h1>
              <p className="hero-text">
                Open-source autopilot for CLI-native development. Roscoe watches the transcript, keeps Guild workers aligned to the brief, drafts the next answer, and escalates to a human only when the work truly needs judgment.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="#getting-started">Get started</a>
                <a className="button button-secondary" href={repoUrl} target="_blank" rel="noreferrer">View on GitHub</a>
              </div>

              <div className="signal-strip" aria-label="Roscoe capabilities">
                {productSignals.map((signal) => (
                  <span key={signal}>{signal}</span>
                ))}
              </div>
            </div>
            <HeroScene />
          </div>
        </section>

        <section className="support-band">
          <div className="support-band-copy">
            <p className="eyebrow">What It Does</p>
            <h2>Roscoe watches. Guild works. You step in when it matters.</h2>
          </div>
          <div className="support-band-grid">
            {developerPillars.map((pillar) => (
              <article key={pillar.label}>
                <strong>{pillar.label}</strong>
                <p>{pillar.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="workflow-section">
          <div className="workflow-intro">
            <p className="eyebrow">Workflow</p>
            <h2>One operator. Many lanes.</h2>
          </div>
          <ol className="workflow-list">
            {workflowMoments.map((moment, index) => (
              <li key={moment.title}>
                <span className="workflow-index">0{index + 1}</span>
                <div>
                  <strong>{moment.title}</strong>
                  <p>{moment.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="developer-surface" id="getting-started">
          <div className="developer-copy">
            <p className="eyebrow">Getting Started</p>
            <h2>Install, onboard, launch.</h2>
            <p>
              Roscoe is for teams that already live in the terminal. The workflow starts with onboarding, builds a project brief, then opens continuous sessions that can resume after relaunch and route developer questions back over SMS when needed.
            </p>
          </div>
          <div className="code-rail">
            <div className="code-rail-head">
              <span>quickstart.sh</span>
              <span>Apache 2.0</span>
            </div>
            <pre>
              <code>{commandDeck.join("\n")}</code>
            </pre>
            <div className="code-links">
              <Link to="/docs">Read the docs</Link>
              <a href={repoUrl} target="_blank" rel="noreferrer">Inspect the code</a>
            </div>
          </div>
        </section>

        <section className="docs-section" id="docs">
          <div className="docs-copy">
            <p className="eyebrow">Docs</p>
            <h2>Read the rules. Run the loop.</h2>
            <p>
              The docs cover install, onboarding, runtime controls, session continuity, SMS handoff, and deployment.
            </p>
          </div>
          <div className="docs-callout">
            <p>Operators, maintainers, and contributors all start in the same place.</p>
            <Link className="button button-primary" to="/docs">Open docs</Link>
          </div>
        </section>

        <section className="open-source-section" id="open-source">
          <div className="open-source-copy">
            <p className="eyebrow">Open Source</p>
            <h2>Apache 2.0. Built to inspect.</h2>
            <p>
              Roscoe is Apache 2.0 licensed, designed for developers who want to run the operator locally, inspect every prompt path, and tune the workflow to their own repositories and teams.
            </p>
          </div>
          <div className="open-source-actions">
            <a className="button button-primary" href={repoUrl} target="_blank" rel="noreferrer">Browse the repository</a>
            <Link className="button button-secondary" to="/docs">Read setup notes</Link>
          </div>
        </section>

        <section className="compliance-section" id="consent">
          <div className="compliance-copy">
            <p className="eyebrow">SMS</p>
            <h2>SMS for real alerts.</h2>
            <p>
              Roscoe can text verification codes, account notifications, work-progress alerts, and direct developer prompts. The public proof surface stays available for Twilio review, but it sits below the product story where it belongs.
            </p>
            <p>{programDescription}</p>
          </div>
          <div className="compliance-layout">
            <ConsentForm sourcePath="/" />
            <div className="message-board compliance-board">
              <h3>Program proof</h3>
              <div className="consent-badges" aria-label="Message categories">
                {consentCategories.map((category) => (
                  <span key={category} className="category-pill">{category}</span>
                ))}
              </div>
              <div className="sample-message">
                <strong>Verification</strong>
                <p>{sampleMessages.twoFactor}</p>
              </div>
              <div className="sample-message">
                <strong>Work alert</strong>
                <p>{sampleMessages.progressAlert}</p>
              </div>
              <p className="disclaimer">{consentDisclosure}</p>
              <p className="disclaimer">{privacyDisclosure}</p>
              <div className="compliance-links">
                <Link to="/sms-consent">Proof of consent</Link>
                <Link to="/privacy">Privacy</Link>
                <Link to="/terms">Terms</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </SiteFrame>
  );
}

function DocsPage() {
  return (
    <SiteFrame>
      <main className="paper-page docs-page">
        <section className="page-hero">
          <p className="eyebrow">Docs</p>
          <h1>Install Roscoe. Train it. Run the lane stack.</h1>
          <p>
            Roscoe is an Apache 2.0 licensed operator for Claude Code and Codex. It watches live CLI sessions, drafts replies, preserves continuity across relaunch, and asks for help only when the work needs a human decision.
          </p>
        </section>

        <section className="docs-grid">
          <article className="paper-panel">
            <h2>Install</h2>
            <pre className="docs-pre"><code>{`npm install -g roscoe\nroscoe`}</code></pre>
            <p>Roscoe runs as a local terminal app. The homepage and SMS consent site are separate from the CLI workflow.</p>
          </article>

          <article className="paper-panel">
            <h2>Onboard</h2>
            <pre className="docs-pre"><code>{`roscoe onboard /path/to/project`}</code></pre>
            <p>Onboarding explores the repo, runs the intent interview, locks the provider, and saves the definition of done into project memory.</p>
          </article>

          <article className="paper-panel">
            <h2>Launch</h2>
            <pre className="docs-pre"><code>{`roscoe start codex@/path/to/project\nroscoe start claude-code@/path/to/project`}</code></pre>
            <p>Each lane resumes from its saved session state, including provider thread IDs, transcript, summaries, and Roscoe’s working context.</p>
          </article>

          <article className="paper-panel">
            <h2>Runtime</h2>
            <p>Projects stay locked to the provider chosen during onboarding. Within that provider, Roscoe can manage model and reasoning automatically or let the operator adjust them.</p>
          </article>

          <article className="paper-panel">
            <h2>Proof Rules</h2>
            <p>Roscoe is tuned tests-first. Frontend, backend, unit or component tests, and e2e tests all have to line up before work is treated as done.</p>
          </article>

          <article className="paper-panel">
            <h2>SMS</h2>
            <p>SMS is optional. Roscoe can send progress alerts, verification codes, and question prompts. The public proof pages exist for compliance, not marketing.</p>
            <div className="docs-inline-links">
              <Link to="/sms-consent">Consent proof</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
            </div>
          </article>
        </section>

        <section className="docs-bottom">
          <div>
            <p className="eyebrow">Repository</p>
            <h2>Source first.</h2>
            <p>Read the code, inspect the prompts, and follow the deploy path in the repository.</p>
          </div>
          <div className="open-source-actions">
            <a className="button button-primary" href={repoUrl} target="_blank" rel="noreferrer">Browse GitHub</a>
            <a className="button button-secondary" href="mailto:hello@roscoe.sh">hello@roscoe.sh</a>
          </div>
        </section>
      </main>
    </SiteFrame>
  );
}

function SmsConsentPage() {
  return (
    <SiteFrame>
      <main className="paper-page">
        <section className="page-hero">
          <p className="eyebrow">Twilio Proof Of Consent</p>
          <h1>Public web opt-in for Roscoe transactional messaging.</h1>
          <p>{programDescription}</p>
        </section>

        <section className="story-grid">
          <article className="paper-panel">
            <h2>Messaging program</h2>
            <ul>
              {consentCategories.map((category) => (
                <li key={category}>{category}</li>
              ))}
            </ul>
            <p>{consentDisclosure}</p>
          </article>

          <article className="paper-panel">
            <h2>Reply handling</h2>
            <ul>
              <li>Reply STOP to opt out.</li>
              <li>Reply HELP for help.</li>
              <li>Msg &amp; data rates may apply.</li>
              <li>Carriers are not liable for delayed or undelivered messages.</li>
            </ul>
          </article>
        </section>

        <section className="consent-layout consent-layout-page">
          <ConsentForm sourcePath="/sms-consent" />
          <div className="message-board">
            <h3>Program samples</h3>
            <div className="sample-message">
              <strong>2FA</strong>
              <p>{sampleMessages.twoFactor}</p>
            </div>
            <div className="sample-message">
              <strong>Opt-in confirmation</strong>
              <p>{sampleMessages.optInConfirmation}</p>
            </div>
            <div className="sample-message">
              <strong>HELP</strong>
              <p>{sampleMessages.help}</p>
            </div>
          </div>
        </section>
      </main>
    </SiteFrame>
  );
}

function PrivacyPage() {
  return (
    <SiteFrame>
      <main className="paper-page legal-page">
        <p className="eyebrow">Privacy Policy</p>
        <h1>Roscoe keeps the ledger narrow.</h1>
        <p>
          Roscoe collects the minimum information needed to send transactional SMS messages and keep a record of consent.
        </p>
        <p>{privacyDisclosure}</p>
        <p>
          Consent records may include your phone number, optional email address, timestamp, source page, IP address, and user agent so Roscoe can prove how and when consent was granted.
        </p>
        <p>
          Roscoe uses this information to deliver transactional messages, maintain compliance records, and answer support requests. Roscoe does not use SMS consent for marketing.
        </p>
      </main>
    </SiteFrame>
  );
}

function TermsPage() {
  return (
    <SiteFrame>
      <main className="paper-page legal-page">
        <p className="eyebrow">Terms & Conditions</p>
        <h1>The wire only carries operational messages.</h1>
        <p>
          By opting in, you agree to receive transactional SMS from Roscoe about verification codes, account notifications, build-progress alerts, and developer prompts tied to active work.
        </p>
        <p>{consentDisclosure}</p>
        <p>
          Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out and HELP for help. Carriers are not liable for delayed or undelivered messages.
        </p>
        <p>
          Roscoe is not a marketing subscription service. Any future expansion beyond transactional messaging would require updated consent language and a new opt-in.
        </p>
      </main>
    </SiteFrame>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/sms-consent" element={<SmsConsentPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
    </Routes>
  );
}
