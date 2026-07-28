# Credential Encryption and Rotation

BYOK secrets enter an authenticated, CSRF-protected server route. AES-256-GCM
stores ciphertext, random 96-bit IV, authentication tag, key version, status,
and four-character suffix. Plaintext exists only in server memory and is never
returned, logged, exported, or audited.

Test decrypts server-side and records only provider/status. Rotate creates a new
IV and increments the version. Delete removes the envelope, resets dependent AI
selection to the paid platform default, and writes metadata-only audit. A wrong
master key fails with a generic authenticated-decryption error.
