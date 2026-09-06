/**
 * The AI lab exists only on a developer's own machine.
 *
 * It runs models against a workspace's real approved knowledge with prompts,
 * policy, model names and knowledge supplied from a form. That is exactly what
 * makes it useful and exactly why it must not be reachable on a deployment:
 * none of those inputs have an owner, an audit trail, or a rate limit, and the
 * surface would be one URL away from anyone who can sign in.
 *
 * Two conditions rather than one, because they fail in different directions:
 *
 *   - `NODE_ENV` is what a production *build* sets, and it is the check that
 *     holds for any host.
 *   - `VERCEL` is set on every Vercel deployment including previews, which are
 *     internet-reachable and are *not* production builds. `NODE_ENV` alone
 *     would leave the lab open on every one of them.
 *
 * Neither is set on a local `pnpm dev`, so the lab opens there and nowhere
 * else. `VERCEL_OIDC_TOKEN` and friends do land in a local `.env.local` via
 * `vercel env pull`, which is why this reads the bare `VERCEL` flag and not a
 * prefix.
 *
 * Checked at request time rather than by omitting the files, because a route
 * that exists and refuses is verifiable from the outside - `curl` gets a 404
 * against a deployment and the page renders locally - while a route removed by
 * bundler configuration can only be confirmed by reading that configuration.
 */
export function devOnlyEnabled(): boolean {
  if (process.env.VERCEL) return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Whether the database this process is pointed at is a local one.
 *
 * The guard above answers "is this a developer's machine". It does not answer
 * "is this a developer's *data*", and in this repo those come apart: the
 * committed `.env.local` points at the live Supabase project with a service
 * role key, so a plain `pnpm dev` is a local server on the production
 * database. The lab's pipeline mode writes - a customer, a conversation,
 * inbound messages, turn records, remembered facts - and every one of those
 * would land in the real CRM, under a synthetic name, indistinguishable from
 * a real record to anyone who did not know the lab existed.
 *
 * So the lab requires both. `pnpm dev:local` supplies the local database; the
 * E2E wrapper already did, which is the only reason testing this was safe.
 *
 * The hostname is compared exactly rather than by substring: `localhost` as a
 * prefix would accept `localhost.example.com`, which is a remote host.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function localDatabaseOnly(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The database the lab would talk to, for a message that has to name it. */
export function configuredDatabaseHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "unset";
  try {
    return new URL(url).hostname;
  } catch {
    return "unreadable";
  }
}
