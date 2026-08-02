import { describe, expect, it } from "vitest";

import { directionFor, locales, parseLocale, parseTheme } from "@/src/lib/i18n/config";
import { dictionaryKeys, translate } from "@/src/lib/i18n/dictionaries";

describe("V1 locale and theme contract", () => {
  it("keeps exact translation-key parity with English fallback", () => {
    const baseline = dictionaryKeys("en");
    for (const locale of locales) {
      expect(dictionaryKeys(locale)).toEqual(baseline);
      expect(translate(locale, "nav.inbox")).not.toMatch(/^nav\./);
    }
  });

  it("makes Persian RTL and falls back safely for invalid preferences", () => {
    expect(directionFor("fa")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("tr")).toBe("ltr");
    expect(parseLocale("unknown")).toBe("en");
    expect(parseTheme("unknown")).toBe("system");
  });
});
