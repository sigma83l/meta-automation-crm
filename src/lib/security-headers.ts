export function buildSecurityHeaders(production: boolean) {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${
      production ? "" : " 'unsafe-eval'"
    } https://challenges.cloudflare.com https://connect.facebook.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // graph.facebook.com is where the Embedded Signup SDK posts; www.facebook.com
    // serves the dialog it opens.
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://graph.facebook.com https://www.facebook.com",
    // The SDK injects a hidden cross-domain iframe even though the signup dialog
    // itself opens as a popup, and without this the whole flow fails silently.
    "frame-src https://challenges.cloudflare.com https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com",
    production ? "upgrade-insecure-requests" : ""
  ]
    .filter(Boolean)
    .join("; ");

  return [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()"
    },
    ...(production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains"
          }
        ]
      : [])
  ] as const;
}
