import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the honesty of the public legal pages.
 *
 * Provisional values carry a specific risk that bracketed placeholders did not:
 * `[LEGAL ENTITY NAME]` is unmistakably unfilled, whereas "Rellooma — registered
 * entity details to be confirmed" reads like prose and can survive a skim. The
 * failure this prevents is publishing a page that looks finished, and being told
 * so by Meta App Review rather than by us.
 *
 * So the rule is a biconditional, and both directions matter: while any page
 * carries a provisional marker the draft notice must be present, and once the
 * markers are gone the notice must come out — a permanent "not reviewed by a
 * lawyer" banner on a finished document is its own kind of wrong.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

const LEGAL_PAGES = [
  "app/terms/page.tsx",
  "app/privacy/page.tsx",
  "app/data-deletion/page.tsx",
  "app/subprocessors/page.tsx"
] as const;

const SHELL = "src/components/ui/legal-page.tsx";
const PROVISIONAL_MARKER = /to be confirmed/i;
const DRAFT_NOTICE = /Draft pending legal review/;

const anyProvisional = LEGAL_PAGES.some((page) => PROVISIONAL_MARKER.test(read(page)));

describe("the draft notice tracks the provisional values", () => {
  it("shows the notice while any value is still to be confirmed", () => {
    if (!anyProvisional) return;
    expect(read(SHELL)).toMatch(DRAFT_NOTICE);
  });

  it("removes the notice once nothing is provisional", () => {
    // The inverse case. A standing disclaimer that the document was never
    // reviewed is not a safe default once it has been.
    if (anyProvisional) return;
    expect(read(SHELL)).not.toMatch(DRAFT_NOTICE);
  });

  it("describes the marker the pages actually use", () => {
    // The notice previously told readers to look for [IN BRACKETS]. Once the
    // brackets were replaced that instruction pointed at nothing, so a reader
    // checking for unfilled values would have found none and concluded the
    // page was complete.
    if (!anyProvisional) return;
    expect(read(SHELL)).toMatch(PROVISIONAL_MARKER);
  });
});

describe("no bracketed placeholder reaches a public page", () => {
  it("leaves none unreplaced except the one still pending a decision", () => {
    // TRANSFER MECHANISM depends on where the database ends up; it is tracked
    // in docs/DATABASE_REGION_MIGRATION.md rather than forgotten.
    const remaining = LEGAL_PAGES.flatMap((page) =>
      [...read(page).matchAll(/\[[A-Z][A-Z ,/&-]+\]/g)].map((match) => match[0])
    );
    expect(remaining).toEqual(["[TRANSFER MECHANISM]"]);
  });
});

describe("the contact addresses are real and reachable", () => {
  it("uses the confirmed mailboxes, not an example domain", () => {
    const privacy = read("app/privacy/page.tsx");
    const deletion = read("app/data-deletion/page.tsx");
    expect(privacy).toContain("privacy@rellooma.com");
    expect(deletion).toContain("privacy@rellooma.com");
    for (const page of LEGAL_PAGES) {
      expect(`${page}:${/example\.(com|org)/.test(read(page))}`).toBe(`${page}:false`);
    }
  });

  it("makes them mailto links, since the deletion page is where friction hurts most", () => {
    expect(read("app/data-deletion/page.tsx")).toContain("mailto:privacy@rellooma.com");
  });
});

describe("every legal page is publicly reachable", () => {
  it("keeps them out of the authenticated route prefixes", () => {
    // Meta App Review fetches these without a session. A legal page behind
    // auth is a rejection, and the failure is invisible while signed in.
    const proxy = read("proxy.ts");
    for (const route of ["/terms", "/privacy", "/data-deletion", "/subprocessors"]) {
      expect(`${route}:${proxy.includes(`"${route}"`)}`).toBe(`${route}:false`);
    }
  });
});
