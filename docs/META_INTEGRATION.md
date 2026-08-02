# Meta Integration

The application implements production-shaped OAuth/Embedded Signup callbacks,
one-time signed state, encrypted token envelopes, asset relationship checks,
GET verification, raw-body App Secret signatures, stored account-to-workspace
routing, deduplication, fast ACK and durable outbox processing.

Opaque WhatsApp media IDs are resolved server-side. Downloads permit only fixed
Graph endpoints followed by approved HTTPS Meta CDN hosts, bounded response
sizes and allowlisted MIME types. Provider URLs are never stored as permanent
media.

WhatsApp template inventory sync normalizes ID, name, language and review
status. No template or free-form outbound adapter is enabled. App Review,
Advanced Access, WABA/phone, Instagram Professional assets and a separate
allowlisted pilot approval remain Prompt 11 requirements.
