# Private Storage Security

`customer-media` and `crm-exports` are private Supabase buckets. The first
object-path segment is the workspace UUID and Storage RLS evaluates the same
active-membership predicate as database RLS. Public URLs are never generated.

Media ingestion verifies actual file bytes with magic-number detection for PNG,
JPEG, WebP and PDF; browser MIME and extension are not trusted. Names are reduced
to a basename, normalized, traversal characters rejected, and a random suffix
added. Metadata stores actual MIME, byte size and SHA-256. Downloads use
authenticated, short-lived signed URLs capped at five minutes.

Exports use generated paths only, apply row/file/byte limits and are available
through 60-second signed URLs while the export job remains unexpired.
