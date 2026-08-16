import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALLOWED_HOSTS,
  MAX_REDIRECT_HOPS,
  authorizeRedirect,
  authorizeRemoteFetch,
  hostIsAddressLiteral,
  hostIsAllowed
} from "@/src/modules/security/ssrf-guard";

const refusal = (url: string) => {
  const verdict = authorizeRemoteFetch(url);
  return verdict.allowed ? "allowed" : verdict.reason;
};

describe("legitimate media URLs are fetched", () => {
  it("allows a Meta CDN link", () => {
    expect(authorizeRemoteFetch("https://lookaside.fbcdn.net/media/abc123").allowed).toBe(true);
  });

  it("allows a per-region CDN hostname", () => {
    // Meta serves media from scontent-<region>.xx.fbcdn.net. Allowing one
    // named region would work in testing and fail everywhere else.
    for (const host of [
      "scontent-lhr8-1.xx.fbcdn.net",
      "scontent-iad3-1.xx.fbcdn.net",
      "scontent.xx.fbcdn.net"
    ]) {
      expect(`${host}:${authorizeRemoteFetch(`https://${host}/v/t1/x.jpg`).allowed}`).toBe(
        `${host}:true`
      );
    }
  });

  it("still refuses a lookalike of the CDN wildcard", () => {
    expect(refusal("https://xx.fbcdn.net.evil.example/x.jpg")).toBe("host_not_allowed");
    expect(refusal("https://notxx.fbcdn.net/x.jpg")).toBe("host_not_allowed");
  });

  it("allows an explicit port 443", () => {
    expect(authorizeRemoteFetch("https://mmg.whatsapp.net:443/media").allowed).toBe(true);
  });
});

describe("the metadata service is unreachable", () => {
  it("refuses the cloud metadata address", () => {
    // 169.254.169.254 is instance credentials on every major provider.
    expect(refusal("https://169.254.169.254/latest/meta-data/")).toBe("host_is_an_address");
  });

  it("refuses loopback in every spelling", () => {
    for (const host of [
      "127.0.0.1",
      "[::1]",
      "[::ffff:127.0.0.1]",
      "2130706433",
      "0177.0.0.1",
      "0x7f000001"
    ]) {
      // A blocklist loses to exactly these; an allowlist never sees them.
      expect(`${host}:${refusal(`https://${host}/`)}`).toBe(`${host}:host_is_an_address`);
    }
  });

  it("recognises address literals directly", () => {
    expect(hostIsAddressLiteral("10.0.0.1")).toBe(true);
    expect(hostIsAddressLiteral("[fd00::1]")).toBe(true);
    expect(hostIsAddressLiteral("lookaside.fbcdn.net")).toBe(false);
  });
});

describe("the allowlist matches on label boundaries", () => {
  it("refuses a lookalike prefix", () => {
    // endsWith would let this through.
    expect(hostIsAllowed("evil-fbcdn.net", ["fbcdn.net"])).toBe(false);
  });

  it("refuses a suffix attack", () => {
    expect(hostIsAllowed("fbcdn.net.evil.example", ["fbcdn.net"])).toBe(false);
  });

  it("accepts the host itself and its subdomains", () => {
    expect(hostIsAllowed("fbcdn.net", ["fbcdn.net"])).toBe(true);
    expect(hostIsAllowed("lookaside.fbcdn.net", ["fbcdn.net"])).toBe(true);
  });

  it("ignores case and a trailing dot", () => {
    // A trailing dot is a valid absolute name that slips past string equality.
    expect(hostIsAllowed("LOOKASIDE.FBCDN.NET.", ["lookaside.fbcdn.net"])).toBe(true);
  });

  it("refuses a host nobody allowed", () => {
    expect(refusal("https://evil.example/payload")).toBe("host_not_allowed");
  });
});

describe("URL shapes that disguise the real target", () => {
  it("refuses credentials that make the host look allowed", () => {
    // The host here is 127.0.0.1; to a human skimming a log it reads as the
    // allowed host.
    expect(refusal("https://lookaside.fbcdn.net@127.0.0.1/")).toBe("credentials_in_url");
  });

  it("refuses a non-default port on an allowed host", () => {
    // How an allowed hostname gets pointed at an internal service.
    expect(refusal("https://lookaside.fbcdn.net:8080/admin")).toBe("non_default_port");
  });

  it("refuses plain http", () => {
    expect(refusal("http://lookaside.fbcdn.net/media")).toBe("scheme_not_https");
  });

  it("refuses schemes that have no business here", () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_INFO",
      "data:text/plain;base64,aGk="
    ]) {
      expect(`${url}:${refusal(url)}`).toBe(`${url}:scheme_not_https`);
    }
  });

  it("refuses something that is not a URL", () => {
    expect(refusal("not a url at all")).toBe("unparseable");
    expect(refusal("")).toBe("unparseable");
  });
});

describe("redirects are re-checked at every hop", () => {
  it("allows a redirect to another permitted host", () => {
    expect(authorizeRedirect("https://mmg.whatsapp.net/media", 0).allowed).toBe(true);
  });

  it("refuses a permitted host redirecting somewhere internal", () => {
    // The standard way around a check performed only on the original URL.
    const verdict = authorizeRedirect("https://169.254.169.254/latest/", 1);
    expect(verdict.allowed).toBe(false);
  });

  it("stops at the hop limit even between permitted hosts", () => {
    // A loop between two allowed hosts passes every individual check and never
    // terminates.
    expect(authorizeRedirect("https://lookaside.fbcdn.net/a", MAX_REDIRECT_HOPS).allowed).toBe(
      false
    );
  });
});

describe("the default allowlist", () => {
  it("contains only Meta and WhatsApp media hosts", () => {
    for (const host of DEFAULT_ALLOWED_HOSTS) {
      expect(`${host}:${/(fbcdn\.net|facebook\.com|whatsapp\.net)$/.test(host)}`).toBe(
        `${host}:true`
      );
    }
  });

  it("contains no address literals or wildcards", () => {
    for (const host of DEFAULT_ALLOWED_HOSTS) {
      expect(`${host}:${hostIsAddressLiteral(host) || host.includes("*")}`).toBe(`${host}:false`);
    }
  });
});
