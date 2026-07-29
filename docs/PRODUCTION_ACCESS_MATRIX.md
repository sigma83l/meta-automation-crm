# Production Access Matrix

| Capability                 | Owner                         | Operator                   | Developer/CI                         | Application runtime    |
| -------------------------- | ----------------------------- | -------------------------- | ------------------------------------ | ---------------------- |
| GitHub repository settings | MANI/org admin                | approved maintainer        | CI read + checks                     | none                   |
| Vercel billing/domain      | MANI                          | approved platform admin    | deploy approved SHA                  | runtime env only       |
| Supabase billing/PITR      | MANI                          | database admin             | migrations through reviewed workflow | pooled DB/API          |
| Supabase service role      | none interactively by default | break-glass only           | deployment secret reference          | server only            |
| Inngest signing/event keys | MANI/platform admin           | rotate/test                | secret reference                     | server only            |
| Meta App/WABA/Instagram    | MANI/client legal owner       | approved integration admin | no live identity                     | encrypted token use    |
| AI platform keys           | MANI                          | approved AI admin          | no plaintext                         | server/BYOK vault only |
| DNS/legal pages            | MANI/legal                    | approved web admin         | verify URLs                          | read only              |

All human production access requires individual identities and MFA. Shared
accounts, credentials in chat, browser-exposed service keys and local plaintext
production `.env` archives are prohibited.
