import type { AiProviderName, ProviderUsage } from "../contracts";

/**
 * Per-vendor request and response shapes.
 *
 * The one place vendor specifics are allowed to exist. Everything else - the
 * prompt, the schema, the timeout, the error classification, the usage
 * accounting - is identical across providers and lives in the transport, so
 * adding a fourth vendor is a table entry rather than a fourth code path.
 *
 * Deliberately no model identifiers here. The model is passed in, resolved from
 * the router's registry, for the reason `router.ts` gives: a vendor deprecating
 * a model should be an environment change rather than a patch.
 */

export type DialectRequest = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}>;

export type Dialect = Readonly<{
  name: Exclude<AiProviderName, "platform">;
  request(input: {
    model: string;
    apiKey: string;
    system: string;
    user: string;
    maxOutputTokens: number;
  }): DialectRequest;
  /** The assistant's text, or null when the response is not shaped as expected. */
  extractText(payload: unknown): string | null;
  extractUsage(payload: unknown, model: string): ProviderUsage | null;
}>;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const numberAt = (value: unknown): number => (typeof value === "number" ? value : 0);

const anthropic: Dialect = {
  name: "anthropic",
  request: ({ model, apiKey, system, user, maxOutputTokens }) => ({
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: {
      model,
      max_tokens: maxOutputTokens,
      system,
      messages: [{ role: "user", content: user }]
    }
  }),
  extractText(payload) {
    const content = record(payload)?.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .map((block) => (record(block)?.type === "text" ? String(record(block)?.text ?? "") : ""))
      .join("");
    return text.length > 0 ? text : null;
  },
  extractUsage(payload, model) {
    const usage = record(record(payload)?.usage);
    if (!usage) return null;
    return {
      inputTokens: numberAt(usage.input_tokens),
      outputTokens: numberAt(usage.output_tokens),
      model
    };
  }
};

const openai: Dialect = {
  name: "openai",
  request: ({ model, apiKey, system, user, maxOutputTokens }) => ({
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: {
      model,
      max_completion_tokens: maxOutputTokens,
      // Vendor-enforced JSON. The schema is still validated after parsing:
      // "is JSON" and "is the object we asked for" are different claims.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    }
  }),
  extractText(payload) {
    const choices = record(payload)?.choices;
    if (!Array.isArray(choices)) return null;
    const message = record(record(choices[0])?.message);
    const content = message?.content;
    return typeof content === "string" && content.length > 0 ? content : null;
  },
  extractUsage(payload, model) {
    const usage = record(record(payload)?.usage);
    if (!usage) return null;
    return {
      inputTokens: numberAt(usage.prompt_tokens),
      outputTokens: numberAt(usage.completion_tokens),
      model
    };
  }
};

const gemini: Dialect = {
  name: "gemini",
  request: ({ model, apiKey, system, user, maxOutputTokens }) => ({
    // The key goes in a header, not the query string: query strings reach
    // access logs and proxies, and this one is a credential.
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens
      }
    }
  }),
  extractText(payload) {
    const candidates = record(payload)?.candidates;
    if (!Array.isArray(candidates)) return null;
    const parts = record(record(candidates[0])?.content)?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts.map((part) => String(record(part)?.text ?? "")).join("");
    return text.length > 0 ? text : null;
  },
  extractUsage(payload, model) {
    const usage = record(record(payload)?.usageMetadata);
    if (!usage) return null;
    return {
      inputTokens: numberAt(usage.promptTokenCount),
      // Reasoning tokens are reported separately and billed at the output
      // rate, so a turn that spends them and a turn that does not have to be
      // distinguishable here. On one measured FAQ lookup the thinking model
      // emitted 796 reasoning tokens against 168 of visible reply and produced
      // the same answer a non-thinking model produced with none - and reading
      // only candidatesTokenCount made that the one number that did not move.
      // Every cost and routing decision downstream reads this.
      outputTokens: numberAt(usage.candidatesTokenCount) + numberAt(usage.thoughtsTokenCount),
      model
    };
  }
};

export const DIALECTS = Object.freeze({ anthropic, openai, gemini });

export type DialectName = keyof typeof DIALECTS;
