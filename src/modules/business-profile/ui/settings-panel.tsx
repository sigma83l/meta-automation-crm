"use client";
import { useState, type FormEvent } from "react";
import type { BusinessProfile, CredentialStatus, FaqItem, PriceItem } from "../contracts";

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string }).token;
}
async function mutate(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("The setting could not be saved.");
  return response.json();
}
export function SettingsPanel({
  profile,
  faqs,
  prices,
  credentials
}: {
  profile: BusinessProfile;
  faqs: FaqItem[];
  prices: PriceItem[];
  credentials: CredentialStatus[];
}) {
  const [message, setMessage] = useState("");
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate("/api/settings/business-profile", "PATCH", {
        brandName: form.get("brandName"),
        description: form.get("description"),
        primaryLanguage: form.get("primaryLanguage"),
        fallbackLanguage: form.get("fallbackLanguage"),
        tone: form.get("tone"),
        answerLength: form.get("answerLength"),
        emojiPolicy: form.get("emojiPolicy"),
        businessHours: Object.fromEntries(
          String(form.get("businessHours") ?? "")
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [day, ...hours] = line.split(":");
              return [day!.trim(), hours.join(":").trim()];
            })
        ),
        timezone: form.get("timezone"),
        forbiddenClaims: String(form.get("forbiddenClaims") ?? "")
          .split("\n")
          .filter(Boolean),
        escalationKeywords: String(form.get("escalationKeywords") ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        lowConfidenceThreshold: Number(form.get("lowConfidenceThreshold")),
        retentionDays: Number(form.get("retentionDays")),
        aiMode: form.get("aiMode"),
        demoModeEnabled: form.get("demoModeEnabled") === "on"
      });
      setMessage("Business profile saved.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  async function addFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("/api/settings/faqs", "POST", Object.fromEntries(form));
    location.reload();
  }
  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("/api/settings/prices", "POST", {
      ...Object.fromEntries(form),
      amountMinor: Math.round(Number(form.get("amount")) * 100)
    });
    location.reload();
  }
  async function credential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate("/api/settings/ai-credentials", "POST", {
        provider: form.get("provider"),
        key: form.get("key")
      });
      setMessage("Credential encrypted and stored. Test it before use.");
      location.reload();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  return (
    <div className="settings-stack">
      {message && (
        <p className="form-status" role="status">
          {message}
        </p>
      )}
      <form className="settings-card" onSubmit={saveProfile}>
        <h2>Business Profile</h2>
        <div className="form-grid">
          <label>
            Brand name
            <input name="brandName" defaultValue={profile.brandName} required />
          </label>
          <label>
            Timezone
            <input name="timezone" defaultValue={profile.timezone} required />
          </label>
          <label className="wide">
            Business hours (one day:value per line)
            <textarea
              name="businessHours"
              defaultValue={Object.entries(profile.businessHours)
                .map(([day, hours]) => `${day}:${hours}`)
                .join("\n")}
              placeholder="monday:09:00-17:00"
            />
          </label>
          <label className="wide">
            Description
            <textarea name="description" defaultValue={profile.description} />
          </label>
          <label>
            Primary language
            <input name="primaryLanguage" defaultValue={profile.primaryLanguage} />
          </label>
          <label>
            Fallback language
            <input name="fallbackLanguage" defaultValue={profile.fallbackLanguage} />
          </label>
          <label>
            Tone
            <select name="tone" defaultValue={profile.tone}>
              <option>friendly</option>
              <option>formal</option>
            </select>
          </label>
          <label>
            Answer length
            <select name="answerLength" defaultValue={profile.answerLength}>
              <option>short</option>
              <option>medium</option>
            </select>
          </label>
          <label>
            Emoji policy
            <select name="emojiPolicy" defaultValue={profile.emojiPolicy}>
              <option>allowed</option>
              <option>limited</option>
              <option>off</option>
            </select>
          </label>
          <label>
            Retention days
            <input
              name="retentionDays"
              type="number"
              min="1"
              max="3650"
              defaultValue={profile.retentionDays}
            />
          </label>
          <label>
            Human-review threshold
            <input
              name="lowConfidenceThreshold"
              type="number"
              min="0"
              max="1"
              step=".01"
              defaultValue={profile.lowConfidenceThreshold}
            />
          </label>
          <label className="wide">
            Forbidden claims
            <textarea name="forbiddenClaims" defaultValue={profile.forbiddenClaims.join("\n")} />
          </label>
          <label className="wide">
            Escalation keywords
            <input name="escalationKeywords" defaultValue={profile.escalationKeywords.join(", ")} />
          </label>
        </div>
        <h2>AI Style & Provider</h2>
        <label>
          AI mode
          <select name="aiMode" defaultValue={profile.aiMode}>
            <option value="PLATFORM_PAID_DEFAULT">Platform paid default</option>
            <option value="WORKSPACE_BYOK_GEMINI">Workspace BYOK — Gemini</option>
            <option value="WORKSPACE_BYOK_OPENAI">Workspace BYOK — OpenAI</option>
            <option value="WORKSPACE_BYOK_ANTHROPIC">Workspace BYOK — Anthropic</option>
            <option value="FREE_GEMINI_DEMO_SYNTHETIC_ONLY">
              Free Gemini — synthetic Demo only
            </option>
          </select>
        </label>
        <label className="check">
          <input name="demoModeEnabled" type="checkbox" defaultChecked={profile.demoModeEnabled} />{" "}
          Explicit Demo mode
        </label>
        <p className="warning-box">
          Free Gemini is prohibited for webhooks, CRM records, customer messages, and media. It
          never receives real data and is never an automatic fallback.
        </p>
        <button type="submit">Save profile</button>
      </form>
      <div className="settings-columns">
        <form className="settings-card" onSubmit={addFaq}>
          <h2>FAQs</h2>
          {faqs.map((item) => (
            <p key={item.id}>
              <strong>{item.question}</strong>
              <br />
              {item.answer}
            </p>
          ))}
          <label>
            Question
            <input name="question" required />
          </label>
          <label>
            Answer
            <textarea name="answer" required />
          </label>
          <input name="language" defaultValue={profile.primaryLanguage} hidden />
          <button>Add FAQ</button>
        </form>
        <form className="settings-card" onSubmit={addPrice}>
          <h2>Pricing</h2>
          {prices.map((item) => (
            <p key={item.id}>
              <strong>{item.name}</strong> — {(item.amountMinor / 100).toFixed(2)} {item.currency}
            </p>
          ))}
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Description
            <input name="description" />
          </label>
          <label>
            Amount
            <input name="amount" type="number" min="0" step=".01" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="USD" pattern="[A-Za-z]{3}" required />
          </label>
          <label>
            Availability
            <select name="availability">
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
              <option value="ask_human">Ask human</option>
            </select>
          </label>
          <button>Add price</button>
        </form>
      </div>
      <form className="settings-card" onSubmit={credential}>
        <h2>Encrypted BYOK credentials</h2>
        <p>
          Keys are accepted only by a server route, encrypted with AES-256-GCM, and never returned.
        </p>
        {credentials.map((item) => (
          <div className="credential-row" key={item.provider}>
            <span>
              <strong>{item.provider}</strong> ••••{item.maskedSuffix} · {item.status}
            </span>
            <button
              type="button"
              onClick={() =>
                mutate("/api/settings/ai-credentials", "PATCH", { provider: item.provider }).then(
                  () => location.reload()
                )
              }
            >
              Test
            </button>
            <button
              type="button"
              className="button-muted"
              onClick={() =>
                mutate("/api/settings/ai-credentials", "DELETE", { provider: item.provider }).then(
                  () => location.reload()
                )
              }
            >
              Delete
            </button>
          </div>
        ))}
        <label>
          Provider
          <select name="provider">
            <option>gemini</option>
            <option>openai</option>
            <option>anthropic</option>
          </select>
        </label>
        <label>
          New or replacement key
          <input name="key" type="password" minLength={12} autoComplete="off" required />
        </label>
        <button>Encrypt and store</button>
      </form>
    </div>
  );
}
