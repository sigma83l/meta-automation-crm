# Relay CRM foundation

Independent production-candidate foundation for workspace-isolated Instagram
and WhatsApp automation with AI-assisted CRM workflows.

The current checkpoint includes workspace-scoped CRM/inbox, private media,
secure Excel/ZIP exports, structured business knowledge, strict AI contracts,
synthetic Demo privacy gates, and encrypted BYOK. Real provider connections,
outbound adapters, and cloud deployment remain absent.

## Requirements

- Node.js 22 LTS recommended (`.nvmrc`); Node 22–26 accepted.
- Corepack and pnpm 11.
- Chromium for Playwright.
- Docker Desktop for local Supabase integration.

## Start

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`. The health endpoint is
`http://localhost:3000/api/health`.

For the complete local auth stack:

```bash
pnpm db:start
pnpm db:reset
pnpm test:db
pnpm test:integration:local
pnpm test:e2e:auth
```

CRM is available at `/crm` and the no-send inbox foundation at `/inbox`.
Business profile, FAQs, pricing, AI style, and credential status are available
at `/settings`.
Export and media limits are documented in `docs/ENVIRONMENT_VARIABLES.md`.

Do not put real credentials into `.env.example`, fixtures, logs, issues, or
chat. Local `.env*` files remain ignored.

## Quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm secret:scan
pnpm exec playwright install chromium
pnpm test:e2e
```

## Current safety posture

- Deterministic synthetic fixtures only.
- WhatsApp and Instagram fake adapters only.
- No provider network call.
- Live send denied by default and no real send adapter exists.
- Fresh local Supabase migrations and isolation tests pass; no hosted migration
  has been applied.
- No remote Git repository or cloud project is connected.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md`, and
`docs/INFRASTRUCTURE_SETUP.md` before extending the foundation.
