import type { ModelRegistry, ModelRole } from "./router";

/**
 * Builds the role-to-model registry from configuration.
 *
 * `router.ts` decides a *role* and refuses to name a model, so something has to
 * supply the names. This is that something, and it reads them from the
 * environment rather than holding them, for the reason the router gives: a
 * provider deprecating a model should be an environment change, not a patch.
 *
 * The `deterministic` role is absent on purpose. It is the role that means "no
 * model call at all", so a configured identifier for it would be a
 * contradiction, and one that would go unnoticed - `resolveModel` would happily
 * return it and a caller would happily use it.
 */

/** Roles that resolve to a model. Everything in MODEL_ROLES except deterministic. */
export const CONFIGURABLE_ROLES = [
  "utility",
  "lookup",
  "primary",
  "escalation",
  "offline_evaluator"
] as const satisfies readonly ModelRole[];

export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

/** The environment variable that carries each role's model identifier. */
export const ROLE_ENVIRONMENT_KEYS = Object.freeze({
  utility: "AI_MODEL_UTILITY",
  lookup: "AI_MODEL_LOOKUP",
  primary: "AI_MODEL_PRIMARY",
  escalation: "AI_MODEL_ESCALATION",
  offline_evaluator: "AI_MODEL_OFFLINE_EVALUATOR"
}) satisfies Readonly<Record<ConfigurableRole, string>>;

export type ModelConfiguration = Readonly<Partial<Record<ConfigurableRole, string>>>;

/**
 * Reads the configured identifiers.
 *
 * Partial by design. A workspace that never escalates has no reason to
 * configure an escalation model, and demanding one to boot would make an
 * unused capability a deployment blocker. `resolveModel` already fails loudly
 * at the point of use, which is where the absence actually matters and where
 * the error can name the role that was wanted.
 */
export function buildModelRegistry(configuration: ModelConfiguration): ModelRegistry {
  const entries = CONFIGURABLE_ROLES.flatMap((role) => {
    const identifier = configuration[role]?.trim();
    return identifier ? ([[role, identifier]] as const) : [];
  });
  return Object.freeze(Object.fromEntries(entries)) as ModelRegistry;
}

/**
 * Which roles a registry can actually serve.
 *
 * For a readiness surface: an operator should be able to see that escalation
 * is unconfigured before a customer with a high-value objection discovers it.
 */
export function configuredRoles(registry: ModelRegistry): readonly ConfigurableRole[] {
  return CONFIGURABLE_ROLES.filter((role) => Boolean(registry[role]));
}
