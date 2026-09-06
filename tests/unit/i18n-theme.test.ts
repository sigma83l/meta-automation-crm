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

  it("translates rather than inheriting English", () => {
    // Key parity alone proved nothing while tr and fa opened with `...en`: every
    // locale then had every key by construction, so the assertion above could
    // not fail and an untranslated string rendered as English. The spread is
    // gone and `Dictionary` now makes an omission a build error; this guards
    // the other half, a key present but left in English.
    //
    // The exceptions are decisions, not gaps: a product name and an initialism
    // that is the same in all three languages.
    const staysEnglish = new Set(["app.name", "nav.crm", "shell.safeMode"]);
    for (const locale of locales) {
      if (locale === "en") continue;
      const untranslated = dictionaryKeys("en").filter(
        (key) =>
          !staysEnglish.has(key) &&
          translate(locale, key as never) === translate("en", key as never)
      );
      expect(`${locale}:${untranslated.join(",")}`).toBe(`${locale}:`);
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
