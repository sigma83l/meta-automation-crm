# Global UI State Contract

**Source page:** 25

Every App page must support relevant states from the server, not locally invented flags:

- loading;
- empty;
- no-results;
- denied;
- disconnected;
- reauth-required;
- policy-blocked;
- paused;
- degraded;
- offline-reconnecting;
- partial-data;
- rate-limited;
- provider-timeout;
- session-expired;
- unexpected-error.

## Recovery rule

Every recoverable state receives exactly one clear next action appropriate to the user's role and authority.

Examples:

- `reauth_required` → reconnect provider.
- `policy_blocked` → show reason + compliant action.
- `trial_ai_capped` → manual/human continues + upgrade CTA.
- `past_due` → billing recovery path.
- `denied` → no fake retry if user lacks role.

UI state must be derived from backend/provider truth.
