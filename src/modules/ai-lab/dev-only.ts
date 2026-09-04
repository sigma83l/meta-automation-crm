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
