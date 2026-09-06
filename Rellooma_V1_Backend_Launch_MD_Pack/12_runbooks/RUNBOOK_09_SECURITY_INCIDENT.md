# Runbook — Security Incident

**Source pages:** 31, 34, 41

1. Classify affected workspace/provider/surface without exposing PII in generic logs.
2. Activate send pause and revoke/rotate scoped credentials when required.
3. Preserve audit evidence.
4. Verify RLS/storage boundaries and session integrity.
5. Inspect webhook spoofing, forged workspace, upload/SSRF, unsafe redirect, secret exposure.
6. Patch and add regression/security test.
7. Rotate affected secrets; deploy exact tested SHA.
8. Document owner actions and post-incident evidence.
