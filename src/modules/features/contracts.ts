/**
 * The capability names the application gates on.
 *
 * A union rather than `string`, so a typo in a gate is a build failure instead
 * of a silent `false` that turns a feature off for everybody. The catalogue
 * seeded by the platform-admin migration holds exactly these keys, and the
 * migration test asserts the two lists still agree.
 */
export const featureKeys = [
  "crm_import",
  "crm_export",
  "ai_replies",
  "ai_proposals",
  "automations",
  "analytics",
  "instagram_channel",
  "whatsapp_channel",
  "saved_views",
  "custom_fields"
] as const;
export type FeatureKey = (typeof featureKeys)[number];

/**
 * The global switches, and what each one may do.
 *
 * Every switch is deny-only: off stops the capability, on restores nothing by
 * itself. `live_provider_send` is the one that matters most — it can halt
 * outbound traffic across every workspace in one write, and it can never be the
 * reason a send is permitted.
 */
export const platformSwitchKeys = [
  "public_signup",
  "live_provider_send",
  "ai_replies",
  "crm_imports",
  "billing_charges"
] as const;
export type PlatformSwitchKey = (typeof platformSwitchKeys)[number];
