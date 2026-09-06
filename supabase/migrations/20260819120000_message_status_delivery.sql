-- Delivery outcomes for an outbound message.
--
-- `message_status` was ('received','prepared','failed'), which can express a
-- message we composed and a message we failed to compose, but not a message
-- that actually left. Every outbound row would therefore have to stay at
-- 'prepared' forever, and the inbox could not distinguish a reply waiting to go
-- from one the customer already has.
--
-- `sent_unknown` is not a nicety. A provider call that times out after the
-- request was accepted leaves us unable to prove either delivery or
-- non-delivery, and the operating rules require that state to be named rather
-- than guessed: a `sent_unknown` message is never blindly retried, because the
-- cheaper mistake is one customer wondering, not two identical messages.
-- `usage-meters.ts` already types AiReplyOutcome with exactly these labels.
--
-- Alone in its own migration on purpose. PostgreSQL refuses to *use* an enum
-- label added in the same transaction that added it, and the next migration
-- creates functions whose bodies name 'sent'.
alter type public.message_status add value if not exists 'sent';
alter type public.message_status add value if not exists 'sent_unknown';
