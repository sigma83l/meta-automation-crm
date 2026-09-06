import type { Metadata } from "next";
import { LegalPage } from "@/src/components/ui/legal-page";

export const metadata: Metadata = {
  title: "Data Deletion — Relay CRM",
  description: "How to request deletion of your data from Relay CRM, and what gets removed."
};

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion Instructions" lastUpdated="14 August 2026">
      <section>
        <h2>Who should use this page</h2>
        <p>
          If you are a <strong>customer of a business</strong> that uses Relay CRM to answer its
          messages, that business holds your record and decides what happens to it. Contact the
          business directly. If you cannot reach them, write to{" "}
          <a href="mailto:privacy@rellooma.com">privacy@rellooma.com</a> and we will forward your
          request and assist as the processor.
        </p>
        <p>
          If you are a <strong>workspace owner or user</strong> of Relay CRM, follow the steps
          below.
        </p>
      </section>

      <section>
        <h2>Delete a single customer record</h2>
        <ol>
          <li>Sign in and open the CRM.</li>
          <li>Open the customer record you want to remove.</li>
          <li>Choose to delete the record and confirm.</li>
        </ol>
        <p>
          Associated private media is removed with the record. Deletion may be refused where audit
          evidence still references that record; in that case the record is retained only for as
          long as the audit-retention schedule requires, and is then removed.
        </p>
      </section>

      <section>
        <h2>Disconnect a messaging channel</h2>
        <p>
          Open <strong>Connections</strong> and disconnect the channel. The stored access tokens for
          that channel are deleted immediately. You can also revoke the connection from your
          Facebook, Instagram or WhatsApp Business settings, which stops any further delivery to us.
        </p>
      </section>

      <section>
        <h2>Delete an entire workspace and account</h2>
        <p>
          Send a request from the email address registered to the workspace owner to{" "}
          <a href="mailto:privacy@rellooma.com">privacy@rellooma.com</a> with the subject{" "}
          <em>Workspace deletion</em>, including the workspace name. We will verify that the request
          genuinely comes from the owner before acting, because this is irreversible.
        </p>
        <p>
          Once verified, we remove the workspace and everything scoped to it: customer records and
          conversations, stored media and generated exports, business profile, FAQs and price list,
          channel connections and their encrypted credentials, automation configuration, and user
          accounts belonging solely to that workspace. Private files are removed before the
          corresponding database rows.
        </p>
        <p>
          Target completion is <strong>30 days</strong> from verification. We will confirm in
          writing when it is done.
        </p>
      </section>

      <section>
        <h2>What may be retained, and why</h2>
        <ul>
          <li>
            <strong>Audit events</strong> — metadata recording who did what and when. These contain
            no message content or credential values, and are the evidence that access was properly
            controlled. Kept on the defined audit-retention schedule.
          </li>
          <li>
            <strong>Billing and tax records</strong> — retained for the period required by
            applicable law in Türkiye, typically for accounting purposes.
          </li>
          <li>
            <strong>Backups</strong> — deleted data persists in encrypted backups until those
            backups age out on their normal rotation, after which it is unrecoverable. We do not
            restore deleted data from backup except to recover from an incident.
          </li>
          <li>
            <strong>Data under legal hold</strong> — retained where we are legally required to
            preserve it, and removed once the hold lifts.
          </li>
        </ul>
      </section>

      <section>
        <h2>Data held by Meta</h2>
        <p>
          Deleting data here does not delete it from WhatsApp, Instagram or Facebook. To remove data
          held by Meta, use the privacy settings of the relevant Meta product, or remove this
          application from your Meta Business account.
        </p>
      </section>

      <section>
        <h2>Export before you delete</h2>
        <p>
          Deletion is permanent. If you want a copy first, generate an export from the CRM before
          submitting a deletion request. Exports are deliberately short-lived, so download it
          promptly.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Deletion requests and questions:{" "}
          <a href="mailto:privacy@rellooma.com">privacy@rellooma.com</a>. Postal address:{" "}
          <em>registered address to be confirmed; write to privacy@rellooma.com in the meantime</em>
          .
        </p>
      </section>
    </LegalPage>
  );
}
