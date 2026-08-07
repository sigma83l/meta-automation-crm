# Collaborator functional differences

Date: 2026-08-07

## Preserved target behavior

| Area                            | Source behavior                                   | Target behavior                                   | Resolution                                                                                                           |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Theme bootstrap                 | Inline pre-hydration script in `app/layout.tsx`   | Dedicated `ThemeScript` using `beforeInteractive` | Kept target component and merged Rellooma metadata around it                                                         |
| Optional URL environment values | Standard optional URL parsing                     | Empty strings normalized to absent values         | Kept target semantics; only a pre-existing comment-spacing format defect changed                                     |
| Auth captcha initialization     | Token derives directly from site-key presence     | Target added a post-mount local fallback          | Preserved the fallback semantics with a lint-safe lazy initializer; transferred the surrounding finalized auth shell |
| Health/infrastructure shape     | Source includes later database-provider reporting | Target retains its deployed health contract       | Kept target API and `src/lib/health.ts` unchanged                                                                    |

## Capability boundary

- No source schema, migration, RLS, API, webhook, provider, queue, send, AI-execution or billing
  behavior was transferred.
- The finalized UI continues to call the target's existing routes and module interfaces because both
  repositories share the same frontend architecture and common history.
- No unsupported route or backend feature was created. The actual target route inventory remains
  the 19 user-facing page/error files and 23 material route states already present at the target base.

## Presentation result

The complete shared Rellooma presentation layer is transferred. The intentional differences above
are implementation safeguards and do not introduce mixed legacy branding or a second design system.
