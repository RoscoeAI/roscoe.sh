import { useMemo, useState } from "react";
import { consentRequestSchema, normalizePhoneNumber } from "../../shared/consent";
import { consentCategories, sampleMessages } from "../../shared/program";

interface ConsentFormProps {
  sourcePath: "/" | "/sms-consent";
}

interface FormState {
  phoneNumber: string;
  email: string;
  consentChecked: boolean;
}

export function ConsentForm({ sourcePath }: ConsentFormProps) {
  const [form, setForm] = useState<FormState>({
    phoneNumber: "",
    email: "",
    consentChecked: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const payload = useMemo(
    () => ({
      phoneNumber: form.phoneNumber,
      email: form.email,
      consentChecked: form.consentChecked,
      sourcePath,
      categories: [...consentCategories],
    }),
    [form, sourcePath],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = consentRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message ?? "Please complete the required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...parsed.data,
          phoneNumber: normalizePhoneNumber(parsed.data.phoneNumber),
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Roscoe could not save your consent.");
      }

      setSuccess(result.optInConfirmationMessage ?? sampleMessages.optInConfirmation);
      setForm({
        phoneNumber: "",
        email: "",
        consentChecked: false,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Roscoe could not save your consent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="consent-card" onSubmit={onSubmit}>
      <div className="consent-header">
        <p className="eyebrow">Web Form Opt-In</p>
        <h3>Get on the Roscoe wire</h3>
      </div>

      <label className="field">
        <span>Phone number</span>
        <input
          type="tel"
          autoComplete="tel"
          placeholder="+14155550123"
          value={form.phoneNumber}
          onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))}
          required
        />
      </label>

      <label className="field">
        <span>Email (optional)</span>
        <input
          type="email"
          autoComplete="email"
          placeholder="hello@roscoe.sh"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
        />
      </label>

      <div className="consent-badges" aria-label="Message categories">
        {consentCategories.map((category) => (
          <span key={category} className="category-pill">{category}</span>
        ))}
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.consentChecked}
          onChange={(event) => setForm((current) => ({ ...current, consentChecked: event.target.checked }))}
        />
        <span>
          I agree to receive transactional SMS from Roscoe for verification codes, account notifications, Guild lane alerts, and developer action prompts.
        </span>
      </label>

      <p className="disclaimer">
        Msg &amp; data rates may apply. Reply STOP to opt out. Reply HELP for help. Carriers are not liable for delayed or undelivered messages.
      </p>

      <p className="disclaimer">
        By opting in, you agree to the <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Policy</a>.
      </p>

      <button className="button button-primary" type="submit" disabled={submitting}>
        {submitting ? "Sending your wire..." : "Join the wire"}
      </button>

      {error && <p className="form-status form-status-error">{error}</p>}
      {success && <p className="form-status form-status-success">{success}</p>}
    </form>
  );
}
