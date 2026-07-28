# Prompt 5 Test Report

## Status

PASS — durable engine contracts and all three Sandbox recipes are complete.

## Evidence

- Fresh five-migration reset: pass.
- Database/RLS: 5 files, 90 assertions.
- Unit/engine scenarios: 8 files, 54 tests.
- Live tenant integration: 5 files, 19 tests.
- Lint, strict TypeScript, build, bundle boundary and secret scan pass.

Scenarios cover all recipes, one private reply, DM wait, no cold DM, Instagram
window closure, WhatsApp free-form/template rules, opt-out, takeover/resume,
images, missing price/low confidence, duplicates, crash-after-send,
retry/dead-letter/recovery, pauses, disabled workspace/automation/connection,
quiet hours, frequency caps, and allowlists.

## Bug fixed

The first run exposed a 60-day WhatsApp window caused by an extra multiplier.
It is now exactly 24 hours with a regression assertion for 86,400 seconds.

## External limit

Hosted Inngest registration and real provider sends remain approved
infrastructure work. Sandbox execution sends nothing externally.
