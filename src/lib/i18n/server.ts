import "server-only";

import { cookies } from "next/headers";

import {
  directionFor,
  localeCookie,
  parseLocale,
  parseTheme,
  themeCookie
} from "@/src/lib/i18n/config";
import { translate } from "@/src/lib/i18n/dictionaries";

export async function getRequestPreferences() {
  const store = await cookies();
  const locale = parseLocale(store.get(localeCookie)?.value);
  const theme = parseTheme(store.get(themeCookie)?.value);
  return {
    locale,
    theme,
    direction: directionFor(locale),
    t: translate.bind(null, locale)
  };
}
