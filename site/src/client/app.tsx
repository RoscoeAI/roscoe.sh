import { Link, Route, Routes } from "react-router-dom";
import {
  consentCategories,
  consentDisclosure,
  frontierHighlights,
  privacyDisclosure,
  programDescription,
  sampleMessages,
} from "../shared/program";
import { ConsentForm } from "./components/ConsentForm";

function SiteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <header className="masthead">
        <Link className="brandmark" to="/">ROSCOE</Link>
        <nav className="topnav">
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
    <div className="hero-art" aria-hidden="true">
      <div className="hero-haze"></div>
      <div className="hero-ground"></div>
      <div className="wagon">
        <div className="wagon-cover"></div>
        <div className="wagon-body"></div>
        <div className="wagon-wheel left"></div>
        <div className="wagon-wheel right"></div>
      </div>
      <div className="telegraph-pole">
        <div className="telegraph-signal"></div>
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
              <p className="eyebrow">Frontier Dispatch for Modern Builders</p>
              <h1>Autopilot for Claude & Codex, styled like a wagon-train telegraph office.</h1>
              <p className="hero-text">
                Roscoe keeps one eye on the build, one ear on the wire, and one hand on the proof path. Guild workers keep moving west until a human reply or a fresh code is needed.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="#consent">Join the wire</a>
                <Link className="button button-secondary" to="/sms-consent">Review consent proof</Link>
              </div>

              <div className="telegraph-note">
                <span>TRANSACTIONAL ONLY</span>
                <span>2FA, alerts, and direct reply prompts</span>
                <span>No marketing campaigns crossing this line</span>
              </div>
            </div>
            <HeroScene />
          </div>
        </section>

        <section className="marquee">
          <span>Events</span>
          <span>2FA</span>
          <span>Account Notifications</span>
          <span>Guild Lane Alerts</span>
          <span>Direct Reply Prompts</span>
        </section>

        <section className="story-grid">
          <article className="paper-panel">
            <h2>What Roscoe sends</h2>
            <p>{programDescription}</p>
            <ul>
              {frontierHighlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </article>

          <aside className="paper-panel">
            <h2>Why the consent surface is plain</h2>
            <p>
              Twilio reviewers need to see the real program in plain language. That means no prechecked boxes, no vague promises, and no hiding the rates, HELP, STOP, privacy, or terms copy.
            </p>
            <p>{privacyDisclosure}</p>
          </aside>
        </section>

        <section className="dispatch-strip">
          <div className="dispatch-strip-copy">
            <p className="eyebrow">Trail Map</p>
            <h2>Roscoe works like a frontier office, not a newsletter.</h2>
            <p>
              Each message has one job: prove account access, report work progress, flag account state, or ask the operator a question that keeps the lane moving. The proof trail lives in the consent ledger from the first click onward.
            </p>
          </div>
          <ol className="trail-list">
            <li>
              <strong>Scout</strong>
              <span>You opt in from a public web form with no prechecked consent.</span>
            </li>
            <li>
              <strong>Wire</strong>
              <span>Roscoe sends verification codes, Guild alerts, and reply prompts only when tied to active work.</span>
            </li>
            <li>
              <strong>Ledger</strong>
              <span>The timestamp, categories, source path, and message program stay stored so the proof path is reviewable.</span>
            </li>
          </ol>
        </section>

        <section className="signal-section" id="consent">
          <div className="section-heading">
            <p className="eyebrow">Join The Wire</p>
            <h2>Subscribe for verification codes, account alerts, and Roscoe build prompts.</h2>
            <p>{consentDisclosure}</p>
          </div>

          <div className="consent-layout">
            <ConsentForm sourcePath="/" />
            <div className="message-board">
              <h3>Sample messages</h3>
              <div className="sample-message">
                <strong>Verification</strong>
                <p>{sampleMessages.twoFactor}</p>
              </div>
              <div className="sample-message">
                <strong>Guild alert</strong>
                <p>{sampleMessages.progressAlert}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="trust-section">
          <div className="trust-copy">
            <p className="eyebrow">Trust, Policies, And Proof</p>
            <h2>Need the plain-language paperwork?</h2>
            <p>
              Twilio reviewers, operators, and future Guild riders can inspect the exact consent surface, the privacy promise, and the wire terms before any number is added to the ledger.
            </p>
          </div>
          <div className="trust-links">
            <Link className="button button-primary" to="/sms-consent">Open proof-of-consent</Link>
            <Link className="button button-secondary trust-link" to="/privacy">Privacy policy</Link>
            <Link className="button button-secondary trust-link" to="/terms">Terms &amp; conditions</Link>
            <a className="button button-secondary trust-link" href="mailto:hello@roscoe.sh">hello@roscoe.sh</a>
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
      <Route path="/sms-consent" element={<SmsConsentPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
    </Routes>
  );
}
