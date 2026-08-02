# Prompt 10 Hosted Preview QA

Status: **FAIL — PREVIEW_HOST_BLOCKED**

No private Preview URL exists. Three Vercel CLI attempts were classified as
Production, including attempts using explicit `--target preview`. The exact
deployments were removed and the project reports no remaining deployments.
Hosted owner signup/login, protected HTTPS routes, browser console/network,
en/tr/fa, RTL, themes and four-boundary `LIVE_SEND=false` checks could not be
performed. Local browser tests and direct synthetic Neon isolation proofs pass,
but they are not substituted for hosted acceptance.

Retry only after Vercel can prove the next deployment target is Preview. Then
run this entire report against one immutable deployment SHA and URL.
