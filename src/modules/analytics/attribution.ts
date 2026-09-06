import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Marketing attribution, carried from a site touchpoint through signup to a
 * verified outcome.
 *
 * Two rules from the pack govern everything here, and they pull in opposite
 * directions, which is why they are worth stating together:
 *
 *   1. Attribution must survive auth and workspace provisioning, and once an
 *      outcome is verified the same chain must be linkable to it. Otherwise
 *      nobody can answer which campaigns produce customers rather than signups.
 *
 *   2. Marketing parameters must never authorize a workspace, role, feature,
 *      trial or plan. They arrive in a URL, which means they arrive from
 *      whoever typed the URL.
 *
 * So attribution is carried carefully and trusted for nothing. The signing here
 * protects integrity in transit; it does not make the contents true, and no
 * amount of valid signature turns `?plan=scale` into an entitlement.
 */

export type AttributionContext = Readonly<{
  locale: string;
  /** Where to send the visitor after auth. Validated, never echoed raw. */
  returnPath: string;
  firstTouch: TouchPoint;
  lastTouch: TouchPoint;
  assistedContentAsset: string | null;
  partnerReferralId: string | null;
  intent: "demo" | "pilot" | null;
}>;

export type TouchPoint = Readonly<{
  source: string | null;
  medium: string | null;
  campaign: string | null;
  occurredAt: string;
}>;

const MAX_FIELD_LENGTH = 120;

function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_FIELD_LENGTH) return null;
  // Marketing parameters are labels. Anything outside this set is either a
  // mistake or an attempt to smuggle markup or a separator through a field that
  // is eventually rendered somewhere.
  return /^[\w.\- ]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Whether a return path may be followed after auth.
 *
 * Only same-origin absolute paths. This is the open-redirect check, and the
 * shapes below are the ones that get through a naive `startsWith("/")`:
 * `//evil.example` is protocol-relative and browsers treat it as a host, and a
 * backslash is normalised to a forward slash by several of them.
 */
export function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (path.includes("://")) return false;
  return true;
}

export const DEFAULT_RETURN_PATH = "/";

/**
 * Builds a context from query parameters.
 *
 * Everything is normalised or discarded; nothing is trusted. An unusable field
 * becomes null rather than failing the whole context, because losing a campaign
 * label is not a reason to lose the visitor.
 */
export function attributionFromQuery(
  query: Readonly<Record<string, string | undefined>>,
  now: Date,
  existing?: AttributionContext
): AttributionContext {
  const touch: TouchPoint = {
    source: cleanField(query.utm_source),
    medium: cleanField(query.utm_medium),
    campaign: cleanField(query.utm_campaign),
    occurredAt: now.toISOString()
  };

  const returnPath =
    query.return_to && isSafeReturnPath(query.return_to)
      ? query.return_to
      : (existing?.returnPath ?? DEFAULT_RETURN_PATH);

  const intent = query.intent === "demo" || query.intent === "pilot" ? query.intent : null;

  return Object.freeze({
    locale: cleanField(query.locale) ?? existing?.locale ?? "en",
    returnPath,
    // First touch is written once and never overwritten. A visitor who arrives
    // from a search ad, leaves, and returns directly a week later was still
    // acquired by the ad; letting the last visit claim it is how paid
    // acquisition ends up looking like organic.
    firstTouch: existing?.firstTouch ?? touch,
    // Last touch updates only when the new visit actually carries marketing
    // parameters. A bare return visit is not a touchpoint, and treating it as
    // one would erase the campaign that brought them back.
    lastTouch:
      touch.source || touch.medium || touch.campaign ? touch : (existing?.lastTouch ?? touch),
    assistedContentAsset: cleanField(query.asset) ?? existing?.assistedContentAsset ?? null,
    partnerReferralId: cleanField(query.ref) ?? existing?.partnerReferralId ?? null,
    intent: intent ?? existing?.intent ?? null
  });
}

/**
 * Fields that may be forwarded to an external analytics tool.
 *
 * Deliberately a projection rather than the whole context. The return path is a
 * URL within our own product and says where somebody was going; the vendor has
 * no use for it and it is the field most likely to carry an identifier in a
 * query string.
 */
export function attributionDimensions(
  context: AttributionContext
): Readonly<Record<string, string>> {
  const dimensions: Record<string, string> = { locale: context.locale };
  if (context.lastTouch.source) dimensions.source = context.lastTouch.source;
  if (context.lastTouch.medium) dimensions.medium = context.lastTouch.medium;
  if (context.lastTouch.campaign) dimensions.campaign = context.lastTouch.campaign;
  return Object.freeze(dimensions);
}

/**
 * Signs a context so it can survive a round trip through the browser.
 *
 * The pack allows either server-side storage or a signed payload. Signing is
 * what makes the pre-signup case work at all: there is no session to store
 * anything against until the visitor has an account.
 *
 * The signature is integrity only. It proves the payload left this server
 * unmodified and proves nothing whatsoever about whether its claims deserve
 * anything — which is the same distinction the OAuth state parameter makes.
 */
export function signAttribution(context: AttributionContext, secret: string): string {
  const payload = Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAttribution(token: string, secret: string): AttributionContext | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1), "base64url");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(payload).digest("base64url"),
    "base64url"
  );
  if (supplied.length !== expected.length) return null;
  if (!timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const context = parsed as AttributionContext;
    // Re-check the return path after verification. The signature proves we
    // signed it, not that it was safe when we did — an unsafe path signed by an
    // older or buggier version of this code must not be honoured now.
    if (!isSafeReturnPath(context.returnPath)) {
      return { ...context, returnPath: DEFAULT_RETURN_PATH };
    }
    return context;
  } catch {
    return null;
  }
}

/**
 * The attribution chain, from touchpoint to verified outcome.
 *
 * This is checklist item 83: a known source is traceable only when every link
 * exists. Reporting a partial chain as attributed is how a campaign gets credit
 * for an outcome nobody connected it to.
 */
export type AttributionChain = Readonly<{
  touchpointAt: string | null;
  handoffAt: string | null;
  workspaceId: string | null;
  outcomeRef: string | null;
}>;

export function isChainComplete(chain: AttributionChain): boolean {
  return (
    chain.touchpointAt !== null &&
    chain.handoffAt !== null &&
    chain.workspaceId !== null &&
    chain.outcomeRef !== null
  );
}

/**
 * Where a chain stops.
 *
 * Named rather than returned as a boolean because the useful question is not
 * "is this attributed" but "where does attribution break", and the answer
 * points at the integration that needs fixing.
 */
export function chainBreaksAt(chain: AttributionChain): string | null {
  if (chain.touchpointAt === null) return "touchpoint";
  if (chain.handoffAt === null) return "handoff";
  if (chain.workspaceId === null) return "workspace";
  if (chain.outcomeRef === null) return "outcome";
  return null;
}

// Note: there is deliberately nothing here that reads a plan, a feature flag or
// a trial length out of an attribution context. Marketing parameters arrive in
// a URL, which is to say they arrive from whoever typed the URL, and a valid
// signature only proves that we signed what we were given.
