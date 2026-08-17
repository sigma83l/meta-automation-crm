import type { Metadata } from "next";
import { LegalPage } from "@/src/components/ui/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Relay CRM",
  description: "How Relay CRM collects, processes, stores and deletes business and customer data."
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="14 August 2026">
      <section>
        <h2>Who we are</h2>
        <p>
          Relay CRM (&ldquo;the Service&rdquo;) is operated by{" "}
          <em>Rellooma — registered entity details to be confirmed</em>, registered at{" "}
          <em>registered address to be confirmed; write to privacy@rellooma.com in the meantime</em>
          . For any privacy question, contact{" "}
          <a href="mailto:privacy@rellooma.com">privacy@rellooma.com</a>.
        </p>
        <p>
          The Service lets a business connect its own messaging channels and manage the resulting
          customer conversations. Each business operates in an isolated workspace. Where a business
          uses the Service to handle its customers&rsquo; messages, that business is the data
          controller for those customer records and we act as a processor on its instructions.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <h3>Account and workspace data</h3>
        <p>
          Email address and authentication credentials for each user, the workspace business
          profile, the FAQs and price list the business chooses to enter, and role assignments
          within the workspace.
        </p>
        <h3>Connected channel data</h3>
        <p>
          When a business connects a WhatsApp Business account, an Instagram professional account or
          a Facebook Page, we receive the messages and events that the platform delivers to us for
          that account. This includes message content, the platform&rsquo;s identifier for the
          sender, timestamps, delivery and read status, and any media attached to a message.
        </p>
        <h3>Customer records</h3>
        <p>
          Contact details and notes that the business enters directly, imports by file, or that are
          derived from an incoming conversation.
        </p>
        <h3>Billing data</h3>
        <p>
          Subscription state and, where a payment method is registered, an opaque token issued by
          our payment provider together with the card brand and last four digits. We do not receive
          or store full card numbers.
        </p>
        <h3>Operational records</h3>
        <p>
          Audit events recording who changed what and when. These deliberately contain metadata
          only, never message content or credential values.
        </p>
      </section>

      <section>
        <h2>How we use it</h2>
        <p>
          To operate the Service: authenticating users, isolating each workspace, delivering
          incoming messages into the correct workspace, running the automations a business has
          configured, producing the exports a business requests, and billing for the subscription.
        </p>
        <p>
          We do not sell personal data, and we do not use customer conversation content for
          advertising or to train our own models.
        </p>
      </section>

      <section>
        <h2>AI processing</h2>
        <p>
          Where a business enables AI-assisted replies, a deliberately narrow slice of context is
          sent to the configured AI provider: at most the eight most recent messages in that
          conversation, the required fields for the task, up to twenty selected FAQs, up to twenty
          price items, and the applicable response policy. Unrelated customers, exports, credentials
          and unnecessary records are never included.
        </p>
        <p>
          No archive of raw AI prompts is created. A business may supply its own provider key, in
          which case its content is sent to that provider under its own agreement with them. AI
          output cannot alter consent, opt-out state, tenant boundaries or sending controls, and low
          confidence or malformed output is routed to a human rather than acted upon.
        </p>
      </section>

      <section>
        <h2>Storage and security</h2>
        <p>
          Records are segregated per workspace and enforced at the database layer, so one workspace
          cannot read another&rsquo;s data. Media and generated exports are held in private storage
          that is not publicly addressable. Provider tokens and any customer-supplied API keys are
          encrypted at rest with AES-256-GCM; the encryption keys are held separately from the
          database. Access by our own staff is limited to what is necessary to operate and support
          the Service.
        </p>
      </section>

      <section>
        <h2>Who else processes data</h2>
        <p>The Service relies on the following categories of subprocessor:</p>
        <ul>
          <li>Cloud hosting and application delivery.</li>
          <li>Managed database, authentication and private file storage.</li>
          <li>
            Meta Platforms, for the messaging channels a business chooses to connect, under
            Meta&rsquo;s own terms.
          </li>
          <li>The configured AI provider, where AI features are enabled.</li>
          <li>Our payment provider, for subscription billing.</li>
          <li>Background job execution for scheduled and durable processing.</li>
        </ul>
        <p>
          A current list naming each subprocessor is available at{" "}
          <a href="/subprocessors">rellooma.com/subprocessors</a>.
        </p>
      </section>

      <section>
        <h2>Retention</h2>
        <p>
          Generated exports are short-lived and expire automatically; expired downloads are refused
          and the underlying file is removed. Each workspace can configure a retention period for
          its own records. Credential envelopes are removed immediately when a connection is
          deleted. Audit events are kept on a defined schedule because they are the evidence that
          access was correctly controlled, and a record may be retained where audit evidence still
          references it.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Depending on where you live, you may have rights to access, correct, export, restrict or
          delete your personal data, and to object to processing. If you are a customer of a
          business using the Service, please contact that business first, since it controls the
          record. Otherwise contact <a href="mailto:privacy@rellooma.com">privacy@rellooma.com</a>.
          Deletion is described in detail on our <a href="/data-deletion">Data Deletion</a> page.
        </p>
        <p>
          You may also lodge a complaint with your local supervisory authority ( the Turkish
          Personal Data Protection Authority (KVKK)).
        </p>
      </section>

      <section>
        <h2>International transfers</h2>
        <p>
          Data may be processed in <strong>India (Mumbai, ap-south-1)</strong> for the primary
          database and file storage, and on Vercel’s global edge network for application hosting.
          Where data leaves your region, we rely on <code>[TRANSFER MECHANISM]</code>.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We will update this page when our processing changes and revise the date shown above.
          Material changes will be notified to workspace owners at their registered email address.
        </p>
      </section>
    </LegalPage>
  );
}
