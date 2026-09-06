import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETURN_PATH,
  attributionDimensions,
  attributionFromQuery,
  chainBreaksAt,
  isChainComplete,
  isSafeReturnPath,
  signAttribution,
  verifyAttribution,
  type AttributionChain,
  type AttributionContext
} from "@/src/modules/analytics/attribution";

const SECRET = "attribution-signing-secret-at-least-32-chars";
const NOW = new Date("2026-08-16T10:00:00.000Z");
const LATER = new Date("2026-08-23T10:00:00.000Z");

const context = (query: Record<string, string | undefined>, existing?: AttributionContext) =>
  attributionFromQuery(query, NOW, existing);

describe("first touch is written once", () => {
  const first = context({ utm_source: "google", utm_medium: "cpc", utm_campaign: "launch" });

  it("captures the arriving campaign", () => {
    expect(first.firstTouch).toMatchObject({
      source: "google",
      medium: "cpc",
      campaign: "launch"
    });
  });

  it("survives a later visit from somewhere else", () => {
    // A visitor acquired by an ad who returns directly a week later was still
    // acquired by the ad; letting the last visit claim it is how paid
    // acquisition ends up looking organic.
    const second = attributionFromQuery({ utm_source: "newsletter" }, LATER, first);
    expect(second.firstTouch.source).toBe("google");
    expect(second.lastTouch.source).toBe("newsletter");
  });

  it("does not let a bare return visit erase the last touch", () => {
    // A visit with no marketing parameters is not a touchpoint.
    const second = attributionFromQuery({}, LATER, first);
    expect(second.lastTouch.source).toBe("google");
  });
});

describe("fields are normalised or discarded", () => {
  it("drops a parameter carrying markup", () => {
    expect(context({ utm_source: "<script>alert(1)</script>" }).lastTouch.source).toBeNull();
  });

  it("drops an absurdly long parameter", () => {
    expect(context({ utm_campaign: "x".repeat(500) }).lastTouch.campaign).toBeNull();
  });

  it("keeps an ordinary label", () => {
    expect(context({ utm_campaign: "summer-2026_promo" }).lastTouch.campaign).toBe(
      "summer-2026_promo"
    );
  });

  it("loses a bad field without losing the visitor", () => {
    // Losing a campaign label is not a reason to lose the context.
    const built = context({ utm_source: "bad|value", utm_medium: "cpc" });
    expect(built.lastTouch.source).toBeNull();
    expect(built.lastTouch.medium).toBe("cpc");
  });

  it("only accepts the two known intents", () => {
    expect(context({ intent: "demo" }).intent).toBe("demo");
    expect(context({ intent: "enterprise-onboarding" }).intent).toBeNull();
  });
});

describe("the return path cannot become an open redirect", () => {
  it("accepts a same-origin path", () => {
    expect(isSafeReturnPath("/inbox")).toBe(true);
  });

  it("refuses an absolute URL", () => {
    expect(isSafeReturnPath("https://evil.example/steal")).toBe(false);
  });

  it("refuses a protocol-relative path", () => {
    // Browsers treat //evil.example as a host, and it survives a naive
    // startsWith("/") check.
    expect(isSafeReturnPath("//evil.example")).toBe(false);
  });

  it("refuses a backslash, which several browsers normalise to a slash", () => {
    expect(isSafeReturnPath("/\\evil.example")).toBe(false);
    expect(isSafeReturnPath("\\\\evil.example")).toBe(false);
  });

  it("falls back to the default rather than following an unsafe path", () => {
    expect(context({ return_to: "https://evil.example" }).returnPath).toBe(DEFAULT_RETURN_PATH);
  });

  it("re-checks the path after signature verification", () => {
    // The signature proves we signed it, not that it was safe when we did.
    const unsafe = { ...context({}), returnPath: "//evil.example" };
    const token = signAttribution(unsafe, SECRET);
    expect(verifyAttribution(token, SECRET)?.returnPath).toBe(DEFAULT_RETURN_PATH);
  });
});

describe("signing protects integrity, not truth", () => {
  const built = context({ utm_source: "google", utm_campaign: "launch", return_to: "/inbox" });

  it("round-trips a context through the browser", () => {
    // Signing is what makes the pre-signup case work: there is no session to
    // store anything against until the visitor has an account.
    expect(verifyAttribution(signAttribution(built, SECRET), SECRET)).toMatchObject({
      returnPath: "/inbox",
      lastTouch: { source: "google", campaign: "launch" }
    });
  });

  it("rejects a payload edited in transit", () => {
    // Edit the decoded payload and re-attach the original signature. Editing
    // the token text directly would not be a test at all: the payload is
    // base64url, so the plaintext never appears in it to be replaced.
    const token = signAttribution(built, SECRET);
    const [payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as {
      lastTouch: { source: string };
    };
    decoded.lastTouch.source = "an-attributed-campaign-we-never-ran";
    const forged = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;
    expect(verifyAttribution(forged, SECRET)).toBeNull();
  });

  it("rejects a signature made with another key", () => {
    expect(verifyAttribution(signAttribution(built, "some-other-secret"), SECRET)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    for (const token of ["", ".", "nodot", "a.b", "....."]) {
      expect(`${token}:${verifyAttribution(token, SECRET)}`).toBe(`${token}:null`);
    }
  });

  it("exports nothing that turns attribution into an entitlement", async () => {
    // Marketing parameters arrive in a URL, which is to say from whoever typed
    // the URL. A valid signature only proves we signed what we were given.
    const exported = await import("@/src/modules/analytics/attribution");
    const suspicious = Object.keys(exported).filter((name) =>
      /plan|entitle|grant|trial|role|feature/i.test(name)
    );
    expect(suspicious).toEqual([]);
  });
});

describe("what reaches an external tool", () => {
  it("forwards the campaign dimensions", () => {
    const built = context({ utm_source: "google", utm_medium: "cpc", utm_campaign: "launch" });
    expect(attributionDimensions(built)).toEqual({
      locale: "en",
      source: "google",
      medium: "cpc",
      campaign: "launch"
    });
  });

  it("never forwards the return path", () => {
    // It is a URL within our own product and the field most likely to carry an
    // identifier in a query string.
    const built = context({ return_to: "/customers/abc-123", utm_source: "google" });
    expect(Object.keys(attributionDimensions(built))).not.toContain("returnPath");
  });

  it("omits dimensions that were never set", () => {
    expect(attributionDimensions(context({}))).toEqual({ locale: "en" });
  });
});

describe("the chain from touchpoint to outcome", () => {
  const complete: AttributionChain = {
    touchpointAt: "2026-08-16T10:00:00.000Z",
    handoffAt: "2026-08-16T10:05:00.000Z",
    workspaceId: "ws_1",
    outcomeRef: "opportunity_1"
  };

  it("is complete only when every link exists", () => {
    expect(isChainComplete(complete)).toBe(true);
  });

  it("is not complete when the outcome is missing", () => {
    // Reporting a partial chain as attributed gives a campaign credit for an
    // outcome nobody connected it to.
    expect(isChainComplete({ ...complete, outcomeRef: null })).toBe(false);
  });

  it("names where it breaks, since that points at what to fix", () => {
    expect(chainBreaksAt({ ...complete, handoffAt: null })).toBe("handoff");
    expect(chainBreaksAt({ ...complete, workspaceId: null })).toBe("workspace");
    expect(chainBreaksAt(complete)).toBeNull();
  });

  it("reports the earliest break, not the last", () => {
    expect(
      chainBreaksAt({ touchpointAt: null, handoffAt: null, workspaceId: null, outcomeRef: null })
    ).toBe("touchpoint");
  });
});
