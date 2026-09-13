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

/**
 * The current theme, as a mark rather than a word.
 *
 * `aria-hidden` throughout: the button that holds this carries the label, and a
 * decorative icon announcing itself as well would have a screen reader read the
 * theme twice. Strokes use `currentColor` so the icon inherits the button's
 * colour in both themes without a second rule.
 */
function ThemeIcon({ theme }: { theme: ThemePreference }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false
  };
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  if (theme === "system") {
    // Half filled: the setting that is neither, and follows the device.
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </svg>
  );
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
  // Light → dark → system → light. `system` stays in the cycle rather than
  // being dropped for a two-state toggle: it is the only setting that keeps
  // following the operating system, and somebody who chose it should not lose
  // it to a control that cannot express it.
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length] as ThemePreference;

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
              {value.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      {/* A button rather than a select: three named options in a dropdown took
          more width than the rest of the topbar and were read once and never
          again. The icon shows the state, the label names it, and the title
          names what comes next -- a cycling control that does not say where it
          is going is a guess every time. */}
      <button
        type="button"
        className="theme-toggle"
        disabled={busy}
        aria-label={`${t("prefs.theme")}: ${t(`prefs.${theme}`)}`}
        title={`${t("prefs.theme")}: ${t(`prefs.${theme}`)} → ${t(`prefs.${nextTheme}`)}`}
        onClick={() => persist(locale, nextTheme)}
      >
        <ThemeIcon theme={theme} />
      </button>
    </div>
  );
}
