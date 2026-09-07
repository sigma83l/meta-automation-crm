import { describe, expect, it } from "vitest";

import { parseRecoveryFragment } from "@/src/modules/auth/recovery-fragment";

/**
 * The shape GoTrue actually produced in production, captured by following a
 * real recovery link:
 *
 *   /auth/callback?next=/reset-password#access_token=...&expires_at=...
 *     &expires_in=3600&refresh_token=...&sb=&token_type=bearer&type=recovery
 *
 * Note `sb=` — an empty parameter in the middle. A parser that split naively on
 * `&` and `=` would have to be careful with it; URLSearchParams is not.
 */
const real =
  "#access_token=eyJhbGciOiJIUzI1NiJ9.header.sig&expires_at=1788811082&expires_in=3600" +
  "&refresh_token=v6xk2v4qbz7t&sb=&token_type=bearer&type=recovery";

describe("recovery fragment", () => {
  it("reads the pair out of the fragment production actually sends", () => {
    expect(parseRecoveryFragment(real)).toEqual({
      accessToken: "eyJhbGciOiJIUzI1NiJ9.header.sig",
      refreshToken: "v6xk2v4qbz7t"
    });
  });

  it("does not care whether the leading hash is there", () => {
    expect(parseRecoveryFragment(real.slice(1))).toEqual(parseRecoveryFragment(real));
  });

  it("returns nothing when there is no fragment at all", () => {
    // The ordinary case for a link that has already been used: GoTrue redirects
    // without a fragment and the page must send the person back to login rather
    // than sit there.
    expect(parseRecoveryFragment("")).toBeUndefined();
    expect(parseRecoveryFragment("#")).toBeUndefined();
  });

  it("refuses half a session", () => {
    // The reset form needs the refresh token to survive the password change.
    // Half a session fails later, and less clearly, than none fails now.
    expect(parseRecoveryFragment("#access_token=abc&type=recovery")).toBeUndefined();
    expect(parseRecoveryFragment("#refresh_token=abc&type=recovery")).toBeUndefined();
    expect(parseRecoveryFragment("#access_token=&refresh_token=abc")).toBeUndefined();
    expect(parseRecoveryFragment("#access_token=abc&refresh_token=   ")).toBeUndefined();
  });

  it("treats a GoTrue error fragment as no session, not as tokens to try", () => {
    // An expired link comes back as an error in the fragment. Reading past it
    // would mean posting stale tokens and reporting a different failure than
    // the one that happened.
    expect(
      parseRecoveryFragment(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"
      )
    ).toBeUndefined();
    expect(
      parseRecoveryFragment("#error_code=otp_expired&access_token=abc&refresh_token=def")
    ).toBeUndefined();
  });

  it("survives a fragment that is not key=value at all", () => {
    expect(parseRecoveryFragment("#justsometext")).toBeUndefined();
    expect(parseRecoveryFragment("#=&=&=")).toBeUndefined();
  });
});
