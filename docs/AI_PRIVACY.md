# AI Privacy and Guardrails

AI receives at most eight recent messages, required fields, twenty selected
FAQs, twenty price items, and relevant response policy. It never receives
unrelated customers, exports, credentials, internal prompts, raw webhook
secrets, or unnecessary database rows.

Unknown or malformed output, unapproved knowledge IDs, missing knowledge,
missing required fields, unavailable prices, prompt-injection patterns, or
confidence below the workspace threshold require human review. AI output cannot
change service windows, consent, opt-out, tenant authority, or live-send gates.
Timeouts and provider errors result in safe, auditable failure.

Free Gemini is synthetic Demo only. Classification is checked before execution;
real webhook, CRM, customer-message, and media input fails closed. Paid/BYOK
failures never downgrade to free mode.
