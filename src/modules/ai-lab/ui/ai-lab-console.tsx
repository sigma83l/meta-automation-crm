"use client";

import { useState } from "react";
import { useHydrated } from "@/src/lib/react/use-hydrated";
import { FACT_CONFIDENCES, type FactConfidence } from "@/src/modules/rcos/memory-policy";

type Mode = "prompt" | "pipeline";
type Turn = Readonly<{ role: "customer" | "business"; content: string }>;
type Faq = { question: string; answer: string };
type Price = {
  name: string;
  amountMinor: number;
  currency: string;
  availability: "available" | "unavailable" | "ask_human";
};
type Fact = { key: string; value: string; confidence: FactConfidence };
type Policy = {
  primaryLanguage: string;
  fallbackLanguage: string;
  forbiddenClaims: readonly string[];
  escalationKeywords: readonly string[];
  lowConfidenceThreshold: number;
};

type LabContext = Readonly<{
  policy: Policy;
  faqItems: readonly (Faq & { id: string })[];
  priceItems: readonly (Price & { id: string })[];
  knownFacts: readonly Readonly<{ key: string; value: string; confidence: string }>[];
  messages: readonly Turn[];
  demoMode: boolean;
}>;

type Call = Readonly<{
  role: string;
  model: string;
  outcome: "ok" | "failed" | "skipped";
  failureCode?: string;
  failureKind?: string;
  deferredToHuman?: boolean;
  usage: Readonly<{ inputTokens: number; outputTokens: number; model: string }> | null;
}>;

type StructuredReply = Readonly<{
  intent: string;
  language: string;
  reply: string;
  confidence: number;
  needsHuman: boolean;
  reason: string;
  extractedFields: Readonly<Record<string, string>>;
  missingRequiredFields: readonly string[];
  knowledgeItemIds: readonly string[];
}>;

type LabResult = Readonly<{
  mode: Mode;
  prompts: Readonly<{ system: string; user: string; classificationSystem: string }>;
  calls: readonly Call[];
  classification?: Readonly<{ intent: string; language: string; highStakes: boolean }>;
  reply?: StructuredReply;
  failure?: Readonly<{ code: string; kind?: string }>;
  record?: Readonly<{ outcome: string; reasonCodes: readonly string[] }>;
  draft?: Readonly<{ text: string; citedRefs: readonly string[] }>;
  conversationId?: string;
  context: LabContext;
}>;

function isFactConfidence(value: string): value is FactConfidence {
  return (FACT_CONFIDENCES as readonly string[]).includes(value);
}

/** Every list editor is the same three buttons, so it is written once. */
function useList<T>(initial: readonly T[]) {
  const [items, setItems] = useState<T[]>([...initial]);
  return {
    items,
    add: (item: T) => setItems((current) => [...current, item]),
    remove: (index: number) => setItems((current) => current.filter((_, i) => i !== index)),
    update: (index: number, patch: Partial<T>) =>
      setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item))),
    reset: () => setItems([...initial])
  };
}

export function AiLabConsole({
  defaultContext,
  aiMode,
  models
}: {
  defaultContext: LabContext;
  aiMode: string;
  models: Readonly<{ utility: string; primary: string; escalation: string }>;
}) {
  const ready = useHydrated();
  const [mode, setMode] = useState<Mode>("prompt");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LabResult | null>(null);
  const [freshConversation, setFreshConversation] = useState(false);

  const [modelNames, setModelNames] = useState({ ...models });
  const [systemPrompt, setSystemPrompt] = useState("");
  const [overridePolicy, setOverridePolicy] = useState(false);
  const [policy, setPolicy] = useState<Policy>(defaultContext.policy);
  const [overrideKnowledge, setOverrideKnowledge] = useState(false);

  const faq = useList<Faq>(
    defaultContext.faqItems.map(({ question, answer }) => ({ question, answer }))
  );
  const prices = useList<Price>(
    defaultContext.priceItems.map(({ name, amountMinor, currency, availability }) => ({
      name,
      amountMinor,
      currency,
      availability
    }))
  );
  // Narrowed at the boundary rather than asserted: the context type carries
  // `confidence` as a plain string, and a value the engine does not rank would
  // be silently unorderable in the memory policy rather than visibly wrong here.
  const facts = useList<Fact>(
    defaultContext.knownFacts.map((fact) => ({
      key: fact.key,
      value: fact.value,
      confidence: isFactConfidence(fact.confidence) ? fact.confidence : "inferred"
    }))
  );

  async function run() {
    if (!message.trim()) return;
    setRunning(true);
    setError("");
    try {
      const { token } = (await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string };
      const response = await fetch("/api/dev/ai-lab", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          mode,
          message,
          history: mode === "prompt" ? history : [],
          models: modelNames,
          ...(systemPrompt.trim() ? { systemPrompt } : {}),
          ...(overridePolicy ? { policy } : {}),
          ...(overrideKnowledge
            ? {
                faqItems: faq.items,
                priceItems: prices.items,
                knownFacts: facts.items
              }
            : {}),
          freshConversation
        })
      });
      const payload = (await response.json()) as LabResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The run failed.");
        return;
      }
      setResult(payload);
      // Prompt mode has no stored conversation, so the console is the only
      // thing that remembers the exchange. Only a real reply is appended: a
      // failed call would otherwise become a "business said nothing" turn that
      // every later run has to read.
      if (payload.mode === "prompt" && payload.reply) {
        setHistory((current) => [
          ...current,
          { role: "customer", content: message },
          { role: "business", content: payload.reply!.reply }
        ]);
      }
      setMessage("");
      setFreshConversation(false);
    } catch {
      setError("The lab could not be reached.");
    } finally {
      setRunning(false);
    }
  }

  // Pipeline mode reads the stored transcript, which is loaded before the turn
  // writes its own reply - so the conversation would end on the customer's
  // message and read as though the assistant said nothing. The composed reply
  // is appended for display only; the next run reloads it from the database
  // like any other turn.
  const transcript =
    mode === "prompt"
      ? history
      : [
          ...(result?.context.messages ?? []),
          ...(result?.draft?.text.trim()
            ? [{ role: "business" as const, content: result.draft.text }]
            : [])
        ];

  return (
    <div className="ai-lab">
      <section className="settings-card ai-lab-controls">
        <div className="ai-lab-modes" role="group" aria-label="Run mode">
          <button
            type="button"
            className={mode === "prompt" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setMode("prompt")}
          >
            Prompt
          </button>
          <button
            type="button"
            className={mode === "pipeline" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setMode("pipeline")}
          >
            Pipeline
          </button>
        </div>
        <p className="ai-lab-hint">
          {mode === "prompt"
            ? "Calls the model directly. No router, no validator, no policy — so it cannot tell you whether a reply would be sent, only what the model wrote."
            : "Stores the message and runs the real turn engine against this workspace's synthetic conversation. Writes rows: a turn record, memory, and an outbound draft when one is approved."}
        </p>

        <label>
          AI mode
          <input value={aiMode} readOnly />
        </label>

        <details open>
          <summary>Models</summary>
          {(["utility", "primary", "escalation"] as const).map((role) => (
            <label key={role}>
              {role}
              <input
                value={modelNames[role]}
                placeholder="inherits AI_MODEL_*"
                onChange={(event) =>
                  setModelNames((current) => ({ ...current, [role]: event.target.value }))
                }
              />
            </label>
          ))}
        </details>

        <details>
          <summary>System prompt</summary>
          <p className="ai-lab-hint">
            Empty uses the prompt the product builds. Anything here replaces it for the reply call
            only — classification keeps its own.
          </p>
          <textarea
            rows={10}
            value={systemPrompt}
            placeholder="Leave empty to use the built prompt"
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
          {result ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSystemPrompt(result.prompts.system)}
            >
              Load the one just used
            </button>
          ) : null}
        </details>

        <details>
          <summary>Policy</summary>
          <label className="check">
            <input
              type="checkbox"
              checked={overridePolicy}
              onChange={(event) => setOverridePolicy(event.target.checked)}
            />
            Override the workspace policy
          </label>
          <label>
            Primary language
            <input
              value={policy.primaryLanguage}
              disabled={!overridePolicy}
              onChange={(event) =>
                setPolicy((current) => ({ ...current, primaryLanguage: event.target.value }))
              }
            />
          </label>
          <label>
            Fallback language
            <input
              value={policy.fallbackLanguage}
              disabled={!overridePolicy}
              onChange={(event) =>
                setPolicy((current) => ({ ...current, fallbackLanguage: event.target.value }))
              }
            />
          </label>
          <label>
            Low confidence threshold
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={policy.lowConfidenceThreshold}
              disabled={!overridePolicy}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  lowConfidenceThreshold: Number(event.target.value)
                }))
              }
            />
          </label>
          <label>
            Forbidden claims (one per line)
            <textarea
              rows={3}
              disabled={!overridePolicy}
              value={policy.forbiddenClaims.join("\n")}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  forbiddenClaims: event.target.value.split("\n").filter((line) => line.trim())
                }))
              }
            />
          </label>
          <label>
            Escalation keywords (one per line)
            <textarea
              rows={3}
              disabled={!overridePolicy}
              value={policy.escalationKeywords.join("\n")}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  escalationKeywords: event.target.value.split("\n").filter((line) => line.trim())
                }))
              }
            />
          </label>
        </details>

        <details>
          <summary>Knowledge and memory</summary>
          <label className="check">
            <input
              type="checkbox"
              checked={overrideKnowledge}
              onChange={(event) => setOverrideKnowledge(event.target.checked)}
            />
            Use the items below instead of the workspace&apos;s
          </label>

          <strong className="ai-lab-group">Approved FAQ</strong>
          {faq.items.map((item, index) => (
            <div className="ai-lab-row" key={`faq-${index}`}>
              <input
                value={item.question}
                placeholder="Question"
                disabled={!overrideKnowledge}
                onChange={(event) => faq.update(index, { question: event.target.value })}
              />
              <input
                value={item.answer}
                placeholder="Answer"
                disabled={!overrideKnowledge}
                onChange={(event) => faq.update(index, { answer: event.target.value })}
              />
              <button
                type="button"
                className="button-muted"
                disabled={!overrideKnowledge}
                onClick={() => faq.remove(index)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!overrideKnowledge}
            onClick={() => faq.add({ question: "", answer: "" })}
          >
            Add FAQ
          </button>

          <strong className="ai-lab-group">Approved prices</strong>
          {prices.items.map((item, index) => (
            <div className="ai-lab-row" key={`price-${index}`}>
              <input
                value={item.name}
                placeholder="Name"
                disabled={!overrideKnowledge}
                onChange={(event) => prices.update(index, { name: event.target.value })}
              />
              <input
                type="number"
                value={item.amountMinor}
                placeholder="Minor units"
                disabled={!overrideKnowledge}
                onChange={(event) =>
                  prices.update(index, { amountMinor: Number(event.target.value) })
                }
              />
              <input
                value={item.currency}
                placeholder="TRY"
                disabled={!overrideKnowledge}
                onChange={(event) => prices.update(index, { currency: event.target.value })}
              />
              <button
                type="button"
                className="button-muted"
                disabled={!overrideKnowledge}
                onClick={() => prices.remove(index)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!overrideKnowledge}
            onClick={() =>
              prices.add({ name: "", amountMinor: 0, currency: "TRY", availability: "available" })
            }
          >
            Add price
          </button>

          <strong className="ai-lab-group">Known about this contact</strong>
          {facts.items.map((item, index) => (
            <div className="ai-lab-row" key={`fact-${index}`}>
              <input
                value={item.key}
                placeholder="Key"
                disabled={!overrideKnowledge}
                onChange={(event) => facts.update(index, { key: event.target.value })}
              />
              <input
                value={item.value}
                placeholder="Value"
                disabled={!overrideKnowledge}
                onChange={(event) => facts.update(index, { value: event.target.value })}
              />
              <select
                value={item.confidence}
                disabled={!overrideKnowledge}
                aria-label="Confidence"
                onChange={(event) =>
                  facts.update(index, { confidence: event.target.value as FactConfidence })
                }
              >
                {FACT_CONFIDENCES.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button-muted"
                disabled={!overrideKnowledge}
                onClick={() => facts.remove(index)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!overrideKnowledge}
            onClick={() => facts.add({ key: "", value: "", confidence: "inferred" })}
          >
            Add fact
          </button>
        </details>
      </section>

      <section className="settings-card ai-lab-stage">
        <div className="ai-lab-transcript" aria-live="polite">
          {transcript.length === 0 ? (
            <p className="ai-lab-hint">Nothing said yet.</p>
          ) : (
            transcript.map((turn, index) => (
              <p className={`ai-lab-turn ${turn.role}`} key={index} dir="auto">
                <span className="eyebrow">{turn.role}</span>
                {turn.content}
              </p>
            ))
          )}
        </div>

        <label>
          Customer message
          <textarea
            rows={3}
            dir="auto"
            value={message}
            placeholder="What is the price, and when are you open?"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>

        <div className="ai-lab-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || running || !message.trim()}
            onClick={run}
          >
            {running ? "Running…" : mode === "prompt" ? "Ask the model" : "Run a turn"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!ready || running}
            onClick={() => {
              setHistory([]);
              setResult(null);
              setError("");
              if (mode === "pipeline") setFreshConversation(true);
            }}
          >
            {mode === "pipeline" ? "Start a new conversation" : "Clear"}
          </button>
          {freshConversation ? <span className="status-pill">next run starts fresh</span> : null}
        </div>

        {error ? (
          <p className="warning-box" role="alert">
            {error}
          </p>
        ) : null}

        {result ? <LabOutcome result={result} /> : null}
      </section>
    </div>
  );
}

/**
 * What happened, in the order it matters when a reply is not what was wanted:
 * the outcome, then why, then what each model call did, then what was sent.
 */
function LabOutcome({ result }: { result: LabResult }) {
  return (
    <div className="ai-lab-outcome">
      {result.record ? (
        <p className="ai-lab-verdict">
          <span className="status-pill">{result.record.outcome}</span>
          {result.record.reasonCodes.join(", ") || "no reason codes"}
        </p>
      ) : null}

      {result.failure ? (
        <p className="warning-box" role="status">
          <strong>{result.failure.code}</strong>
          {result.failure.kind ? ` · ${result.failure.kind}` : ""}
          {result.failure.code === "NO_PRIMARY_PROVIDER"
            ? " — no model is configured for the primary role, so nothing was called. Set AI_MODEL_PRIMARY or name a model above."
            : ""}
        </p>
      ) : null}

      {result.reply ? (
        <article className="ai-lab-reply">
          <span className="eyebrow">Draft reply</span>
          <p dir="auto">{result.reply.reply}</p>
          <dl className="ai-lab-facts">
            <div>
              <dt>intent</dt>
              <dd>{result.reply.intent}</dd>
            </div>
            <div>
              <dt>language</dt>
              <dd>{result.reply.language}</dd>
            </div>
            <div>
              <dt>confidence</dt>
              <dd>{result.reply.confidence}</dd>
            </div>
            <div>
              <dt>needs human</dt>
              <dd>{String(result.reply.needsHuman)}</dd>
            </div>
            <div>
              <dt>cited</dt>
              <dd>{result.reply.knowledgeItemIds.length}</dd>
            </div>
            <div>
              <dt>reason</dt>
              <dd>{result.reply.reason}</dd>
            </div>
          </dl>
        </article>
      ) : null}

      {result.draft ? (
        <article className="ai-lab-reply">
          <span className="eyebrow">Composed reply</span>
          <p dir="auto">{result.draft.text || "(empty — the turn produced no text)"}</p>
        </article>
      ) : null}

      {result.classification ? (
        <p className="ai-lab-hint">
          Classified as <strong>{result.classification.intent}</strong> in{" "}
          {result.classification.language}
          {result.classification.highStakes ? " · high stakes" : ""}
        </p>
      ) : null}

      <table className="ai-lab-calls">
        <caption>Model calls</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Model</th>
            <th scope="col">Outcome</th>
            <th scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {result.calls.length === 0 ? (
            <tr>
              <td colSpan={4}>No model was called.</td>
            </tr>
          ) : (
            result.calls.map((call, index) => (
              <tr key={index}>
                <td>{call.role}</td>
                <td>{call.usage?.model || call.model || "—"}</td>
                <td>
                  {call.outcome}
                  {call.failureCode ? ` · ${call.failureCode}` : ""}
                  {call.failureKind ? ` (${call.failureKind})` : ""}
                  {call.deferredToHuman ? " · asked for a person" : ""}
                </td>
                <td>
                  {call.usage
                    ? `${call.usage.inputTokens} in / ${call.usage.outputTokens} out`
                    : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <details>
        <summary>Exactly what was sent to the model</summary>
        <strong className="ai-lab-group">System</strong>
        <pre>{result.prompts.system}</pre>
        <strong className="ai-lab-group">User</strong>
        <pre>{result.prompts.user}</pre>
      </details>
    </div>
  );
}
