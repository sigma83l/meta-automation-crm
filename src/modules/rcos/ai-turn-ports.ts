import { appError, err, ok, type Result } from "@/src/lib/result";
import type { AiProvider, AiReplyInput } from "@/src/modules/ai/contracts";
import { buildModelRegistry, type ModelConfiguration } from "./model-registry";
import {
  generativeCallBudget,
  mayAnswerCustomer,
  resolveModel,
  selectRole,
  type ModelRegistry,
  type ModelRole
} from "./router";
import type { ComposedReply, TurnEvent, TurnPorts, TurnUnderstanding } from "./turn-engine";

/**
 * Builds the three turn ports that involve a model.
 *
 * The engine calls understand, then retrieve, then decide, then compose. That
 * ordering is why this is two model calls rather than one: classification is
 * cheap `utility` work that must happen before retrieval, and the reply cannot
 * honestly be written until retrieval has said what is approved. A single call
 * producing both would be drafting the answer before knowing the facts.
 *
 * retrieve is here too, and that is the point of the file. The model may only
 * cite what it was offered, and the validator may only approve amounts that
 * were offered - so the offering, the citing and the approving all have to
 * agree. Deriving them from one context makes them agree by construction
 * rather than by two callers remembering to use the same identifiers.
 */

export type TurnContext = Readonly<{
  requiredFields: readonly string[];
  faqItems: readonly Readonly<{ id: string; question: string; answer: string }>[];
  priceItems: readonly Readonly<{
    id: string;
    name: string;
    amountMinor: number;
    currency: string;
    availability: "available" | "unavailable" | "ask_human";
  }>[];
  policy: AiReplyInput["policy"];
  /** Times a reply may state, e.g. opening hours. Approved elsewhere. */
  approvedTimes: readonly string[];
  messages: AiReplyInput["messages"];
  classification: AiReplyInput["classification"];
  demoMode: boolean;
}>;

export type AiTurnDependencies = Readonly<{
  /**
   * Providers by role. Every one is optional, including the two a working turn
   * needs, because "this workspace has no usable credential" is a state the
   * caller must be able to express — and the honest way to express it is an
   * absent provider, which `providerFor` already resolves to an uncertain
   * understanding and therefore to a handoff. Requiring them here would only
   * move the lie to the call site. escalation absent means the turn stays
   * primary.
   */
  providers: Readonly<{ utility?: AiProvider; primary?: AiProvider; escalation?: AiProvider }>;
  models: ModelConfiguration;
  loadContext(event: TurnEvent): Promise<TurnContext>;
  /** Observes each model call. Never receives message content. */
  onCall?(record: {
    role: ModelRole;
    model: string;
    usage: ReturnType<AiProvider["getUsageMetadata"]>;
  }): void;
}>;

/** Renders a price exactly as the prompt renders it, so the two never diverge. */
export function formatApprovedAmount(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

function replyInput(event: TurnEvent, context: TurnContext): AiReplyInput {
  return {
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    messages: context.messages,
    requiredFields: context.requiredFields,
    faqItems: context.faqItems,
    priceItems: context.priceItems,
    policy: context.policy,
    classification: context.classification,
    demoMode: context.demoMode
  };
}

/**
 * What a failed or absent model call becomes.
 *
 * Never an exception and never a guess. The engine has exactly one safe
 * response to not knowing - hand to a human - and it reaches that through a
 * low-confidence understanding, which is the same path a genuinely uncertain
 * model takes. One route, exercised by both causes.
 */
const UNCERTAIN: TurnUnderstanding = Object.freeze({
  intents: Object.freeze([Object.freeze({ name: "unknown", confidence: 0 })]),
  locale: "und"
});

export function createAiTurnPorts(
  dependencies: AiTurnDependencies
): Pick<TurnPorts, "understand" | "retrieve" | "compose"> {
  const registry: ModelRegistry = buildModelRegistry(dependencies.models);
  // One turn's context and classification, keyed by event. The engine runs a
  // turn start to finish, so this never needs to outlive one.
  const contexts = new Map<string, TurnContext>();
  const classifications = new Map<string, { confidence: number; highStakes: boolean }>();

  async function contextFor(event: TurnEvent): Promise<TurnContext> {
    const existing = contexts.get(event.eventId);
    if (existing) return existing;
    const loaded = await dependencies.loadContext(event);
    contexts.set(event.eventId, loaded);
    return loaded;
  }

  function providerFor(role: ModelRole): Result<AiProvider> {
    const provider =
      role === "escalation"
        ? (dependencies.providers.escalation ?? dependencies.providers.primary)
        : role === "utility"
          ? dependencies.providers.utility
          : dependencies.providers.primary;
    return provider
      ? ok(provider)
      : err(appError("AI_CREDENTIAL_UNAVAILABLE", `No provider for the ${role} role.`));
  }

  return {
    async understand(event) {
      const context = await contextFor(event);
      const model = resolveModel("utility", registry);
      const provider = providerFor("utility");
      if (!model.ok || !provider.ok) return UNCERTAIN;

      const classified = await provider.value.classifyTurn(replyInput(event, context));
      dependencies.onCall?.({
        role: "utility",
        model: model.value,
        usage: provider.value.getUsageMetadata()
      });
      if (!classified.ok) return UNCERTAIN;

      classifications.set(event.eventId, {
        confidence: classified.value.confidence,
        highStakes: classified.value.highStakes
      });
      return {
        intents: [{ name: classified.value.intent, confidence: classified.value.confidence }],
        locale: classified.value.language
      };
    },

    async retrieve(event) {
      const context = await contextFor(event);
      return {
        // The ref is the approved item's own id, which is what the model is
        // shown and therefore the only thing it can honestly cite.
        facts: [
          ...context.faqItems.map((item) => ({ ref: item.id, value: item.answer })),
          ...context.priceItems.map((item) => ({
            ref: item.id,
            value: `${item.name}: ${formatApprovedAmount(item.amountMinor, item.currency)}`
          }))
        ],
        approvedAmounts: context.priceItems.map((item) =>
          formatApprovedAmount(item.amountMinor, item.currency)
        ),
        approvedTimes: context.approvedTimes
      };
    },

    async compose(event, decision) {
      const context = await contextFor(event);
      const signals = {
        confidence: classifications.get(event.eventId)?.confidence ?? 0,
        highStakes: classifications.get(event.eventId)?.highStakes ?? false,
        // The decision already answers this: a turn resolved without generation
        // has nothing left for a model to add.
        answerIsKnown: decision.type === "wait"
      };
      const role = selectRole("customer_reply", signals);

      // A role that may not speak to a customer, or no budget, means no call.
      if (!mayAnswerCustomer(role) || generativeCallBudget(role, signals) === 0) {
        return { text: "", citedRefs: [], claimsCompletion: false };
      }

      const model = resolveModel(role, registry);
      const provider = providerFor(role);
      if (!model.ok || !provider.ok) return { text: "", citedRefs: [], claimsCompletion: false };

      const generated = await provider.value.generateStructuredReply(replyInput(event, context));
      dependencies.onCall?.({
        role,
        model: model.value,
        usage: provider.value.getUsageMetadata()
      });
      // An empty draft fails validation, which routes to a handoff. That is the
      // intended destination for "the model could not answer this".
      if (!generated.ok) return { text: "", citedRefs: [], claimsCompletion: false };

      return composedFrom(generated.value, decision.type);
    }
  };
}

/**
 * Turns a structured reply into what the engine sends.
 *
 * `claimsCompletion` is derived from the decision, not from the text. The model
 * is told never to claim an action was taken, and it has no way to take one, so
 * the only turn that can legitimately claim completion is one that requested a
 * tool. Detecting a claim in the prose is a job for the validator, which owns
 * comparing a draft against what is known and has the context to do it in three
 * languages; doing it here would be a second, worse implementation of that.
 */
export function composedFrom(
  reply: Readonly<{ reply: string; knowledgeItemIds: readonly string[]; needsHuman: boolean }>,
  decisionType: "answer" | "clarify" | "qualify" | "book" | "handoff" | "wait"
): ComposedReply {
  // A model asking for a human gets one: an empty draft fails validation and
  // resolves to a handoff, rather than sending a reply it disowned.
  if (reply.needsHuman) return { text: "", citedRefs: [], claimsCompletion: false };
  return {
    text: reply.reply,
    citedRefs: [...reply.knowledgeItemIds],
    claimsCompletion: decisionType === "book"
  };
}
