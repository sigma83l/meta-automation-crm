import { isIP } from "node:net";

/**
 * Whether a URL may be fetched by the server.
 *
 * This exists because the system fetches media by URL — Meta hands us a link to
 * an attachment and we download it. That is a server-side request whose target
 * is chosen by data arriving from outside, which is the definition of an SSRF
 * sink. Inside a hosting environment the loopback and link-local ranges are not
 * theoretical: 169.254.169.254 is the cloud metadata service on every major
 * provider, and reaching it means handing over instance credentials.
 *
 * An allowlist of hosts, then, not a blocklist of addresses. Blocklists lose
 * here — decimal-encoded IPs, IPv6-mapped IPv4, a redirect to somewhere else,
 * a DNS name that resolves to 127.0.0.1 — and the loss is total when it
 * happens. An allowlist means an attacker must compromise a host we already
 * trust rather than merely name one we forgot.
 *
 * Pure and synchronous. DNS resolution is deliberately not done here: a name
 * that resolves safely at check time can resolve elsewhere at fetch time (DNS
 * rebinding), so the defence has to be that we only ever talk to hosts we
 * named, not that the address looked acceptable once.
 */

/**
 * Hosts whose media this system is expected to fetch.
 *
 * `xx.fbcdn.net` rather than a specific `scontent.*` name, because Meta serves
 * media from per-region hostnames like `scontent-lhr8-1.xx.fbcdn.net`. Naming
 * one of them allows exactly one region and silently fails everywhere else —
 * which is a false negative that looks like broken media rather than like a
 * security control, and so gets "fixed" by someone widening this list under
 * time pressure.
 *
 * Still narrow: `xx.fbcdn.net` matches on a label boundary, so it covers Meta's
 * media subdomains and nothing else.
 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  "lookaside.fbcdn.net",
  "xx.fbcdn.net",
  "graph.facebook.com",
  "mmg.whatsapp.net",
  "media.whatsapp.net"
]);

export type FetchVerdict =
  Readonly<{ allowed: true; url: URL }> | Readonly<{ allowed: false; reason: FetchRefusal }>;

export type FetchRefusal =
  | "unparseable"
  | "scheme_not_https"
  | "credentials_in_url"
  | "non_default_port"
  | "host_is_an_address"
  | "host_not_allowed";

/**
 * Whether a host string is a literal IP address in any of the spellings that
 * get past a naive check.
 *
 * `isIP` covers dotted-quad and standard IPv6. The rest are the forms a
 * blocklist misses: bracketed IPv6 as it appears in a URL, IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`), and the integer and octal spellings of an address that
 * browsers and some resolvers still accept.
 */
export function hostIsAddressLiteral(host: string): boolean {
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(unbracketed) !== 0) return true;
  // ::ffff:127.0.0.1 and friends — isIP accepts these, but check explicitly in
  // case the host arrives without brackets and with a zone or scope suffix.
  if (unbracketed.includes(":")) return true;
  // 2130706433 (decimal) and 0177.0.0.1 (octal) both resolve to loopback.
  if (/^\d+$/.test(unbracketed)) return true;
  if (/^0[0-7]+(\.[0-7]+)*$/.test(unbracketed)) return true;
  if (/^0x[0-9a-f]+$/i.test(unbracketed)) return true;
  return false;
}

function normaliseHost(host: string): string {
  // Hostnames are case-insensitive, and a trailing dot is a valid absolute form
  // that would otherwise slip past a string comparison.
  return host.toLowerCase().replace(/\.$/, "");
}

/**
 * Whether a host is covered by the allowlist.
 *
 * Subdomains match, since CDN hostnames are generated per-object, but only on a
 * label boundary — `evil-fbcdn.net` and `fbcdn.net.evil.com` must not match
 * `fbcdn.net`, and a plain `endsWith` lets both through.
 */
export function hostIsAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const candidate = normaliseHost(host);
  return allowedHosts.some((allowed) => {
    const target = normaliseHost(allowed);
    return candidate === target || candidate.endsWith(`.${target}`);
  });
}

export function authorizeRemoteFetch(
  rawUrl: string,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS
): FetchVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "unparseable" };
  }

  // https only. Plain http is both interceptable and the easier scheme to
  // redirect somewhere internal; file:, gopher: and data: have no business here
  // at all.
  if (url.protocol !== "https:") {
    return { allowed: false, reason: "scheme_not_https" };
  }

  // https://allowed.example@127.0.0.1/ has a host of 127.0.0.1 and reads, to a
  // human skimming a log, as the allowed host.
  if (url.username !== "" || url.password !== "") {
    return { allowed: false, reason: "credentials_in_url" };
  }

  // A non-default port on a CDN is not a legitimate media URL, and it is how an
  // allowed hostname gets pointed at an internal service.
  if (url.port !== "" && url.port !== "443") {
    return { allowed: false, reason: "non_default_port" };
  }

  if (hostIsAddressLiteral(url.hostname)) {
    return { allowed: false, reason: "host_is_an_address" };
  }

  if (!hostIsAllowed(url.hostname, allowedHosts)) {
    return { allowed: false, reason: "host_not_allowed" };
  }

  return { allowed: true, url };
}

/**
 * Whether a redirect may be followed.
 *
 * Every hop is re-checked against the same allowlist, because a permitted host
 * answering with a 302 to somewhere internal is the standard way around a check
 * performed only on the original URL. The hop limit is separate: a redirect
 * loop between two allowed hosts passes every individual check and still never
 * terminates.
 */
export const MAX_REDIRECT_HOPS = 3;

export function authorizeRedirect(
  location: string,
  hopsSoFar: number,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS
): FetchVerdict {
  if (hopsSoFar >= MAX_REDIRECT_HOPS) {
    return { allowed: false, reason: "host_not_allowed" };
  }
  return authorizeRemoteFetch(location, allowedHosts);
}
