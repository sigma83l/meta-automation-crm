import { appError, err, ok, type Result } from "@/src/lib/result";
import {
  structuredReplySchema,
  turnClassificationSchema,
  type AiProvider,
  type AiReplyInput,
  type ClassifiedProviderError,
  type ProviderUsage,
  type StructuredReply,
  type TurnClassification
} from "../contracts";
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  buildSystemPrompt,
  buildUserPrompt
} from "../prompt";
import type { Dialect } from "./dialects";

/**
 * Turns a vendor dialect into an `AiProvider`.
 *
 * Everything that is the same for every vendor lives here: the prompt, the
 * schema, the timeout, the classification of failures and the usage
 * accounting. A vendor contributes the URL, the headers and two extractors,
 * and gets the safety properties whether or not it thought about them.
 *
 * Two things this deliberately does not do:
 *
 *   - It does not retry. A retry policy belongs where the attempt is durable
 *     and bounded, which is the outbox, not inside a single call. Retrying
 *     here would multiply a rate limit by the number of attempts and hide the
 *     signal that caused it.
 *
 *   - It does not repair invalid output. A response that does not match the
 *     schema is a failed call, classified as `invalid_output`, and the turn
 *     falls back the way every other failure does. Coercing a malformed reply
 *     into a valid-looking one produces exactly the confident nonsense the
 *     schema exists to exclude.
 */

/**
 * Bounded so a runaway generation cannot bill or stall the turn indefinitely.
 *
 * 4000 rather than a tighter number because the reply schema already permits a
 * 4000-character reply, and the JSON wrapper, the extracted fields and the
 * cited ids all have to fit alongside it. A cap below what the schema allows
 * does not save money on a well-behaved turn - it truncates the JSON on a long
 * one, which fails parsing, classifies as invalid_output and spends the whole
 * call to produce a handoff.
 *
 * It also has to cover reasoning tokens on models that think by default, since
 * those count against the same ceiling and are emitted before the answer.
 */
const MAX_OUTPUT_TOKENS = 4000;

/** Response bodies larger than this are refused before parsing. */
const MAX_RESPONSE_BYTES = 512 * 1024;

export type HttpAiProviderOptions = Readonly<{
  dialect: Dialect;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Injected so tests exercise the real parsing without a network. */
  fetcher?: typeof fetch;
  /**
   * Replaces the built system prompt for the reply call only.
   *
   * Exists for the local prompt lab, which has to be able to try a wording
   * against the real transport, the real schema and the real citation filter -
   * a prompt validated anywhere else has not been validated. Nothing in the
   * product sets it: the turn runtime passes it only when a developer typed
   * one, and classification keeps its own prompt either way, since the two
   * answer different questions.
   */
  systemPromptOverride?: string;
}>;

/**
 * Maps a transport or protocol failure onto the kinds the engine handles.
 *
 * The distinction that matters is retryable versus not: a 429 or a timeout
 * will likely succeed later and belongs back on the queue, whereas a rejected
 * key will fail identically forever and must surface to an operator instead of
 * being retried until the budget is gone.
 */
export function classifyHttpFailure(status: number): ClassifiedProviderError {
  if (status === 401 || status === 403) return { kind: "authentication", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status === 408 || status === 504) return { kind: "timeout", retryable: true };
  if (status >= 500) return { kind: "unavailable", retryable: true };
  return { kind: "invalid_output", retryable: false };
}

function classifyThrown(error: unknown): ClassifiedProviderError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return { kind: "timeout", retryable: true };
  return { kind: "unavailable", retryable: true };
}

/**
 * Extracts the JSON object from a model's text.
 *
 * Tolerant of a code fence and of surrounding prose, because a model told to
 * emit bare JSON will occasionally wrap it anyway, and discarding an otherwise
 * valid reply over punctuation would be its own kind of wrong. Tolerant of
 * nothing else: the result is still parsed and then validated against the
 * schema, so a "repaired" string that is not the expected object still fails.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function createHttpAiProvider(options: HttpAiProviderOptions): AiProvider {
  const { dialect, apiKey, model, timeoutMs } = options;
  const fetcher = options.fetcher ?? fetch;
  let usage: ProviderUsage | null = null;
  let lastFailure: ClassifiedProviderError | null = null;

  async function call(system: string, user: string): Promise<Result<unknown>> {
    const { url, headers, body } = dialect.request({
      model,
      apiKey,
      system,
      user,
      maxOutputTokens: MAX_OUTPUT_TOKENS
    });
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: { ...headers },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      lastFailure = classifyThrown(error);
      return err(
        appError("PROVIDER_UNAVAILABLE", "The AI provider could not be reached.", {
          retryable: lastFailure.retryable,
          details: { kind: lastFailure.kind }
        })
      );
    }

    if (!response.ok) {
      lastFailure = classifyHttpFailure(response.status);
      // The body is not read or logged. A provider error body can echo the
      // request, and the request contains customer messages.
      return err(
        appError(
          lastFailure.kind === "authentication"
            ? "AI_CREDENTIAL_UNAVAILABLE"
            : "PROVIDER_UNAVAILABLE",
          "The AI provider refused the request.",
          { retryable: lastFailure.retryable, details: { kind: lastFailure.kind } }
        )
      );
    }

    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) {
      lastFailure = { kind: "invalid_output", retryable: false };
      return err(
        appError("PROVIDER_UNAVAILABLE", "The AI provider returned an oversized response.", {
          details: { kind: "invalid_output" }
        })
      );
    }
    try {
      return ok(JSON.parse(raw));
    } catch {
      lastFailure = { kind: "invalid_output", retryable: false };
      return err(
        appError("PROVIDER_UNAVAILABLE", "The AI provider returned an unreadable response.", {
          details: { kind: "invalid_output" }
        })
      );
    }
  }

  /** Shared by both calls: parse the text, validate it, classify a failure. */
  function parseAgainst<T>(
    payload: unknown,
    schema: { safeParse(value: unknown): { success: boolean; data?: T; error?: unknown } }
  ): Result<T> {
    const text = dialect.extractText(payload);
    if (text === null) {
      lastFailure = { kind: "invalid_output", retryable: false };
      return err(
        appError("PROVIDER_UNAVAILABLE", "The AI provider returned no usable content.", {
          details: { kind: "invalid_output" }
        })
      );
    }
    const parsed = schema.safeParse(extractJsonObject(text));
    if (!parsed.success || parsed.data === undefined) {
      lastFailure = { kind: "invalid_output", retryable: false };
      const issues = (parsed.error as { issues?: { path: (string | number)[] }[] } | undefined)
        ?.issues;
      return err(
        // Names fields, never values: a rejected reply is still customer-derived.
        appError("VALIDATION_ERROR", "The AI provider returned an off-contract reply.", {
          details: {
            kind: "invalid_output",
            fields: (issues ?? [])
              .map((issue) => issue.path.join("."))
              .filter(Boolean)
              .join(",")
              .slice(0, 200)
          }
        })
      );
    }
    return ok(parsed.data);
  }

  return Object.freeze({
    name: dialect.name,

    async classifyTurn(input: AiReplyInput): Promise<Result<TurnClassification>> {
      const called = await call(
        buildClassificationSystemPrompt(input),
        buildClassificationUserPrompt(input)
      );
      if (!called.ok) return called;
      usage = dialect.extractUsage(called.value, model);
      return parseAgainst<TurnClassification>(called.value, turnClassificationSchema);
    },

    async generateStructuredReply(input: AiReplyInput): Promise<Result<StructuredReply>> {
      const called = await call(
        options.systemPromptOverride ?? buildSystemPrompt(input),
        buildUserPrompt(input)
      );
      if (!called.ok) return called;

      usage = dialect.extractUsage(called.value, model);

      const parsed = parseAgainst<StructuredReply>(called.value, structuredReplySchema);
      if (!parsed.ok) return parsed;

      // A citation the turn never offered is invented, and citing it is how an
      // unapproved claim acquires the appearance of a source. Dropped here
      // rather than blocked: the validator decides what an uncited reply is
      // worth, and it has the retrieval context needed to judge that.
      const offered = new Set([
        ...input.faqItems.map((item) => item.id),
        ...input.priceItems.map((item) => item.id)
      ]);
      return ok(
        Object.freeze({
          ...parsed.value,
          knowledgeItemIds: parsed.value.knowledgeItemIds.filter((id) => offered.has(id))
        })
      );
    },

    async testConnection(): Promise<Result<{ available: boolean }>> {
      // A real call, because the failure this must catch is a rejected key,
      // and nothing short of a request discovers that.
      const called = await call('Reply with the JSON object {"ok":true} and nothing else.', "ping");
      return called.ok ? ok({ available: true }) : err(called.error);
    },

    classifyProviderError(error: unknown): ClassifiedProviderError {
      if (error instanceof Error) return classifyThrown(error);
      return lastFailure ?? { kind: "unavailable", retryable: true };
    },

    getUsageMetadata(): ProviderUsage | null {
      return usage;
    }
  });
}
