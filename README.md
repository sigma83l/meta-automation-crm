# Relay CRM foundation

Independent production-candidate foundation for workspace-isolated Instagram
and WhatsApp automation with AI-assisted CRM workflows.

Prompt 0 intentionally contains no real authentication, provider connection,
database migration, outbound provider adapter, or cloud deployment. It provides
the tested contracts and safe sandbox on which those stages will be built.

## Requirements

- Node.js 22 LTS recommended (`.nvmrc`); Node 22–26 accepted.
- Corepack and pnpm 11.
- Chromium for Playwright.
- Docker is optional until local Supabase work begins.

## Start

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`. The health endpoint is
`http://localhost:3000/api/health`.

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
- No Supabase migration has been applied.
- No remote Git repository or cloud project is connected.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md`, and
`docs/INFRASTRUCTURE_SETUP.md` before extending the foundation.
