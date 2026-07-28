"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const recipes = [
  ["INSTAGRAM_COMMENT_TO_DM", "Instagram Post/Reel Comment → DM Lead Collector"],
  ["INSTAGRAM_INBOUND_DM", "Instagram Inbound DM Lead Collector"],
  ["WHATSAPP_INBOUND", "WhatsApp Inbound Lead Collector"]
] as const;
const steps = [
  "Basics",
  "Channel & Trigger",
  "Questions",
  "Business Answers",
  "AI Style",
  "Rules",
  "Test & Activate"
] as const;
type RecipeId = (typeof recipes)[number][0];

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}

export function AutomationBuilder() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [recipe, setRecipe] = useState<RecipeId>(recipes[0][0]);
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState("Name\nEmail");
  const [tone, setTone] = useState("workspace-default");
  const [quietHours, setQuietHours] = useState(true);
  const [frequencyCap, setFrequencyCap] = useState(3);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const response = await fetch("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({
        name,
        recipe,
        requestId,
        configuration: {
          questions: questions
            .split("\n")
            .map((question) => question.trim())
            .filter(Boolean),
          tone,
          quietHours,
          frequencyCap
        }
      })
    });
    if (response.ok) {
      setName("");
      setCurrentStep(0);
      setRequestId(crypto.randomUUID());
      setBusy(false);
      router.refresh();
    } else {
      setBusy(false);
      setMessage("Check the automation details and try again.");
    }
  }

  function next() {
    if (currentStep === 0 && name.trim().length < 2) {
      setMessage("Add an automation name to continue.");
      return;
    }
    if (currentStep === 2 && !questions.trim()) {
      setMessage("Add at least one customer question.");
      return;
    }
    setMessage("");
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  }

  return (
    <section className="panel automation-builder" id="new">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Seven-step wizard</span>
          <h2>Create automation</h2>
        </div>
        <span>Sandbox safe</span>
      </div>
      <ol className="wizard-rail" aria-label="Seven setup steps">
        {steps.map((step, index) => (
          <li
            className={index === currentStep ? "current" : index < currentStep ? "complete" : ""}
            key={step}
          >
            <button type="button" onClick={() => index <= currentStep && setCurrentStep(index)}>
              <span>{index < currentStep ? "✓" : index + 1}</span>
              {step}
            </button>
          </li>
        ))}
      </ol>
      <form className="wizard-form" onSubmit={create}>
        {currentStep === 0 ? (
          <div className="wizard-panel">
            <span className="eyebrow">01 · Basics</span>
            <label>
              Automation name
              <input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="New lead collector"
                required
                minLength={2}
              />
            </label>
          </div>
        ) : null}
        {currentStep === 1 ? (
          <div className="wizard-panel">
            <span className="eyebrow">02 · Channel & trigger</span>
            <div className="recipe-grid">
              {recipes.map(([id, label]) => (
                <button
                  type="button"
                  aria-pressed={recipe === id}
                  onClick={() => setRecipe(id)}
                  key={id}
                >
                  <strong>{label}</strong>
                  <span>
                    {id === "WHATSAPP_INBOUND"
                      ? "24-hour service-window policy"
                      : "User-initiated Instagram messaging"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {currentStep === 2 ? (
          <div className="wizard-panel">
            <span className="eyebrow">03 · Questions</span>
            <label>
              Customer questions (one per line)
              <textarea
                value={questions}
                onChange={(event) => setQuestions(event.target.value)}
                rows={5}
                required
              />
            </label>
            <p>Required fields are asked one at a time and confirmed answers are not repeated.</p>
          </div>
        ) : null}
        {currentStep === 3 ? (
          <div className="wizard-panel">
            <span className="eyebrow">04 · Business answers</span>
            <h3>Approved facts only</h3>
            <p>
              Replies use workspace pricing and FAQs. Missing approved knowledge always routes to
              human review.
            </p>
            <Link href="/settings">Review pricing and FAQs</Link>
          </div>
        ) : null}
        {currentStep === 4 ? (
          <div className="wizard-panel">
            <span className="eyebrow">05 · AI style</span>
            <label>
              Response style
              <select value={tone} onChange={(event) => setTone(event.target.value)}>
                <option value="workspace-default">Use workspace default</option>
                <option value="friendly-short">Friendly and short</option>
                <option value="formal-medium">Formal and medium</option>
              </select>
            </label>
            <p>Low confidence and invalid structured output stop for human review.</p>
          </div>
        ) : null}
        {currentStep === 5 ? (
          <div className="wizard-panel">
            <span className="eyebrow">06 · Rules</span>
            <label className="check">
              <input
                type="checkbox"
                checked={quietHours}
                onChange={(event) => setQuietHours(event.target.checked)}
              />
              Respect workspace quiet hours
            </label>
            <label>
              Maximum automated sends per conversation
              <input
                type="number"
                min={1}
                max={20}
                value={frequencyCap}
                onChange={(event) => setFrequencyCap(Number(event.target.value))}
              />
            </label>
          </div>
        ) : null}
        {currentStep === 6 ? (
          <div className="wizard-panel wizard-review">
            <span className="eyebrow">07 · Test & activate</span>
            <h3>{name}</h3>
            <p>{recipes.find(([id]) => id === recipe)?.[1]}</p>
            <ul>
              <li>{questions.split("\n").filter(Boolean).length} configured questions</li>
              <li>Sandbox test required before activation</li>
              <li>Every outbound attempt passes the policy gate</li>
            </ul>
          </div>
        ) : null}
        <div className="wizard-actions">
          <button
            className="button-muted"
            type="button"
            onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
            disabled={currentStep === 0}
          >
            Back
          </button>
          {currentStep < steps.length - 1 ? (
            <button key="continue-action" type="button" onClick={next}>
              Continue
            </button>
          ) : (
            <button key="create-action" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create draft"}
            </button>
          )}
        </div>
      </form>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

export function AutomationActions({ id, status }: { id: string; status: string }) {
  const [message, setMessage] = useState("");
  const [currentStatus, setCurrentStatus] = useState(status);

  async function run(action: string) {
    const response = await fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ action })
    });
    setMessage(response.ok ? `${action.replace("_", " ")} completed.` : "Action failed.");
    if (response.ok) {
      setCurrentStatus(
        action === "activate"
          ? "ACTIVE"
          : action === "safe_test"
            ? "READY"
            : action === "pause" || action === "stop_queued"
              ? "PAUSED"
              : currentStatus
      );
    }
  }

  return (
    <div className="automation-actions">
      <button onClick={() => run(currentStatus === "ACTIVE" ? "pause" : "activate")}>
        {currentStatus === "ACTIVE" ? "Pause now" : "Activate"}
      </button>
      <button onClick={() => run("safe_test")}>Run safe test</button>
      <button onClick={() => run("stop_queued")} className="button-muted">
        Stop queued messages
      </button>
      <span className="status-pill">Current status: {currentStatus}</span>
      {message && <span role="status">{message}</span>}
    </div>
  );
}
