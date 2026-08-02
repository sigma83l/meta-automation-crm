# Internationalization and RTL

Supported UI locales are `en`, `tr` and `fa`; English is the safe fallback.
Locale is held in the `relay_locale` SameSite cookie for SSR and stored on the
authenticated profile. Customer-message languages remain separate business
settings.

Persian sets `dir="rtl"` on the document boundary. English and Turkish use
`ltr`. Layout uses logical CSS properties; directional conversation badges and
selected rails mirror in RTL. URLs, IDs, recipe codes and mixed customer text
use isolated direction where rendered.

Dates and counts use `Intl` with the active UI locale. Canonical timestamps
remain UTC and business operations retain the workspace timezone. Translation
dictionaries have exact key parity tests. Browser tests cover locale switching,
cookie persistence, no hydration mismatch, 390 px Persian overflow and keyboard
labels.

Typography uses the available Geist/Inter operational stack for Latin and
Vazirmatn/Tahoma fallbacks for Persian. No external font download is required
for the production build.
