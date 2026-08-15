# Runbook — Resend / Transactional Email Incident

**Source pages:** 23, 30, 41

1. Keep durable DB event/ticket as source of truth.
2. Inspect provider delivery webhook status.
3. Retry transient delivery failure asynchronously.
4. Honor suppression/consent before marketing sends.
5. Keep Auth verification/recovery authority in Supabase Auth.
6. Never place recovery tokens/OTP/password in logs or support context.
7. Confirm notify/news domain behavior before closing.
