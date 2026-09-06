/**
 * No-op stand-in for the `server-only` package under Vitest.
 *
 * `server-only` throws on import outside a React Server Component, which makes
 * every server module in `src/modules/**` unimportable from a unit test — the
 * reason the PayTR adapter had no unit coverage at all. The real guard is
 * enforced by the Next bundler at build time and by `pnpm bundle:scan`, neither
 * of which this alias touches, so stubbing it for the Node test runner does not
 * weaken the client/server boundary.
 */
export {};
