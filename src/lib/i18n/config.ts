export const locales = ["en", "tr", "fa"] as const;
export type Locale = (typeof locales)[number];

export const themes = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof themes)[number];

export const localeCookie = "relay_locale";
export const themeCookie = "relay_theme";

export function parseLocale(value: unknown): Locale {
  return locales.includes(value as Locale) ? (value as Locale) : "en";
}

export function parseTheme(value: unknown): ThemePreference {
  return themes.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

export function directionFor(locale: Locale) {
  return locale === "fa" ? "rtl" : "ltr";
}
