# Automation Send Policy Matrix

Every send rechecks workspace, automation/version, connection, tenant,
idempotency, consent/opt-out, service window, quiet hours, frequency cap, AI
confidence, human takeover, and non-production allowlist.

| Message                               | Eligibility                                                |
| ------------------------------------- | ---------------------------------------------------------- |
| Instagram private reply               | Matching comment and unused single reply                   |
| Instagram DM                          | Trusted user initiation and open window                    |
| Instagram cold DM                     | Never                                                      |
| WhatsApp free form                    | Open trusted 24-hour window                                |
| WhatsApp template                     | Approved template and valid opt-in outside window          |
| Consented reminder                    | Trusted schedule, approved template, consent, opt-in, once |
| After-hours/low-confidence escalation | Human review; no cross-channel customer send               |
| Human reply                           | Same channel policy; takeover actor recorded               |
| Missing price/low confidence          | Human review                                               |
| Paused, opted out, unhealthy          | Block                                                      |

AI can extract and recommend but cannot alter the matrix.
