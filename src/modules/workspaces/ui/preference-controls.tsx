"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  directionFor,
  localeCookie,
  locales,
  themeCookie,
  themes,
  type Locale,
  type ThemePreference
} from "@/src/lib/i18n/config";
import { useI18n } from "@/src/lib/i18n/client";

function applyTheme(preference: ThemePreference) {
  const resolved =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function PreferenceControls({
  locale: localeProp,
  theme: themeProp,
  compact = false
}: {
  locale?: Locale;
  theme?: ThemePreference;
  compact?: boolean;
}) {
  const router = useRouter();
  const preferences = useI18n();
  const { t } = preferences;
  const locale = localeProp ?? preferences.locale;
  const theme = themeProp ?? preferences.theme;
  const [busy, setBusy] = useState(false);

  async function persist(nextLocale: Locale, nextTheme: ThemePreference) {
    setBusy(true);
    document.cookie = `${localeCookie}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.cookie = `${themeCookie}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    localStorage.setItem(localeCookie, nextLocale);
    localStorage.setItem(themeCookie, nextTheme);
    document.documentElement.lang = nextLocale;
    document.documentElement.dir = directionFor(nextLocale);
    applyTheme(nextTheme);
    const csrf = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
      body: JSON.stringify({ locale: nextLocale, theme: nextTheme })
    }).catch(() => undefined);
    router.refresh();
    setBusy(false);
  }

  return (
    <div className={compact ? "preference-controls compact" : "preference-controls"}>
      <label>
        <span>{t("prefs.language")}</span>
        <select
          aria-label={t("prefs.language")}
          value={locale}
          disabled={busy}
          onChange={(event) => persist(event.target.value as Locale, theme)}
        >
          {locales.map((value) => (
            <option key={value} value={value}>
              {value === "en" ? "English" : value === "tr" ? "Türkçe" : "فارسی"}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("prefs.theme")}</span>
        <select
          aria-label={t("prefs.theme")}
          value={theme}
          disabled={busy}
          onChange={(event) => persist(locale, event.target.value as ThemePreference)}
        >
          {themes.map((value) => (
            <option key={value} value={value}>
              {t(`prefs.${value}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
