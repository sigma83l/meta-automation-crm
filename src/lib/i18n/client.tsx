"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Locale, ThemePreference } from "@/src/lib/i18n/config";
import { translate, type TranslationKey } from "@/src/lib/i18n/dictionaries";

const PreferenceContext = createContext<{ locale: Locale; theme: ThemePreference }>({
  locale: "en",
  theme: "system"
});

export function I18nProvider({
  locale,
  theme,
  children
}: {
  locale: Locale;
  theme: ThemePreference;
  children: ReactNode;
}) {
  return (
    <PreferenceContext.Provider value={{ locale, theme }}>{children}</PreferenceContext.Provider>
  );
}

export function useI18n() {
  const { locale, theme } = useContext(PreferenceContext);
  return {
    locale,
    theme,
    t: (key: TranslationKey) => translate(locale, key),
    text: (english: string, turkish: string, persian: string) =>
      locale === "tr" ? turkish : locale === "fa" ? persian : english
  };
}
