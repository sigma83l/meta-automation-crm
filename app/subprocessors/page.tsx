import type { Metadata } from "next";
import { LegalPage } from "@/src/components/ui/legal-page";

export const metadata: Metadata = {
  title: "Subprocessors — Relay CRM",
  description:
    "The third-party services Relay CRM uses to deliver the product, what each one receives, and where it processes data."
};

/**
 * The subprocessor list referenced by the privacy policy.
 *
 * Every entry here is a service the code actually talks to — the list was
 * derived from the outbound hosts in `src/` and `app/` and from the dependency
 * manifest, not from a template. That matters: a subprocessor list is a
 * commitment, and one naming a service that never sees data is as wrong as one
 * omitting a service that does. It has to be revised whenever an integration is
 * added.
 *
 * The "what it receives" column is deliberately specific. "Usage data" tells a
 * reader nothing and is the phrasing that makes these pages worthless; whether
 * a given processor sees the text of a customer's message is exactly what
 * somebody is trying to find out.
 */
export default function SubprocessorsPage() {
  return (
    <LegalPage title="Subprocessors" lastUpdated="17 August 2026">
      <section>
        <h2>What this page is</h2>
        <p>
          To run Relay CRM we rely on the third-party services listed below. Under data protection
          law these are <strong>subprocessors</strong>: they process data on our instructions, on
          behalf of the businesses that use our product.
        </p>
        <p>
          Each entry states what that service actually receives. Where a service never sees the
          content of your customers&apos; messages, that is said explicitly, because it is usually
          the thing people want to know.
        </p>
      </section>

      <section>
        <h2>Current subprocessors</h2>

        <h3>Supabase</h3>
        <p>
          <strong>Purpose:</strong> the primary database, authentication, and file storage.
          <br />
          <strong>Receives:</strong> everything the product stores — workspace and user accounts,
          customer records, conversations and message content, uploaded media, and audit logs.
          <br />
          <strong>Processing region:</strong> ap-south-1 (Mumbai, India).
        </p>

        <h3>Vercel</h3>
        <p>
          <strong>Purpose:</strong> application hosting and serverless execution.
          <br />
          <strong>Receives:</strong> HTTP request metadata, including IP addresses and request
          paths, and application logs. Message content passes through memory while a request is
          served but is not stored by the hosting layer.
          <br />
          <strong>Processing region:</strong> global edge network, with functions executing in the
          project&apos;s configured region.
        </p>

        <h3>Meta Platforms (WhatsApp Business, Instagram)</h3>
        <p>
          <strong>Purpose:</strong> the messaging channels themselves.
          <br />
          <strong>Receives:</strong> the messages sent to and from your customers, and the account
          identifiers Meta issues, such as phone numbers and Instagram account IDs. Meta is the
          origin of this data rather than only a recipient — the conversation happens on their
          platform, and their own terms govern it.
          <br />
          <strong>Processing region:</strong> Meta&apos;s global infrastructure.
        </p>

        <h3>Cloudflare</h3>
        <p>
          <strong>Purpose:</strong> bot protection on the sign-up, sign-in and recovery forms
          (Turnstile).
          <br />
          <strong>Receives:</strong> the visitor&apos;s IP address and a challenge token at the
          moment a form is submitted. It never receives customer records or message content.
          <br />
          <strong>Processing region:</strong> global.
        </p>

        <h3>Inngest</h3>
        <p>
          <strong>Purpose:</strong> orchestration of background jobs — webhook processing, retries,
          scheduled billing and trial tasks.
          <br />
          <strong>Receives:</strong> identifiers only. Job payloads carry workspace, event and
          record IDs so a worker can fetch what it needs from the database; the text of a
          customer&apos;s message is never placed in a job payload.
          <br />
          <strong>Processing region:</strong> United States.
        </p>

        <h3>AI model provider</h3>
        <p>
          <strong>Purpose:</strong> generating suggested and automated replies.
          <br />
          <strong>Receives:</strong> the conversation context needed to produce a reply, which
          includes customer message content. This is the subprocessor with the most sensitive
          access, and it is the reason the product limits what is sent: only recent turns and
          approved business knowledge are included, never a whole conversation history or a
          customer&apos;s full record.
          <br />
          <strong>Processing region:</strong> depends on the configured provider. A workspace that
          supplies its own provider key sends this data to that provider directly under its own
          agreement with them.
        </p>

        <h3>Payment provider</h3>
        <p>
          <strong>Purpose:</strong> subscription billing.
          <br />
          <strong>Receives:</strong> the billing contact&apos;s email address and subscription
          state. Card details are entered on the provider&apos;s own hosted page and never reach our
          servers; we store only a provider reference and the last four digits.
          <br />
          <strong>Processing region:</strong> the provider&apos;s own infrastructure.
        </p>
      </section>

      <section>
        <h2>What is not on this list</h2>
        <p>
          We do not send customer records, message content, phone numbers, email addresses or
          attachments to any general-purpose analytics or advertising service. Product analytics is
          restricted to counts, categories and durations, enforced in code by an allowlist of
          permitted fields rather than by a policy that has to be remembered.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          This list changes when an integration is added or removed. The date at the top of this
          page reflects the last revision.
        </p>
      </section>
    </LegalPage>
  );
}
