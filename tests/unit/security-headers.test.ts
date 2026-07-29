import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "@/src/lib/security-headers";

describe("security headers", () => {
  it("denies framing, objects, unsafe base URLs, and caches no API data", () => {
    const headers = Object.fromEntries(
      buildSecurityHeaders(false).map(({ key, value }) => [key, value])
    );
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds transport security only for the explicit production deployment mode", () => {
    const headers = Object.fromEntries(
      buildSecurityHeaders(true).map(({ key, value }) => [key, value])
    );
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["Content-Security-Policy"]).toContain("upgrade-insecure-requests");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });
});
