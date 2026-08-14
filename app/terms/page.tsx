import type { Metadata } from "next";
import { LegalPage } from "@/src/components/ui/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Relay CRM",
  description: "The terms governing use of the Relay CRM service."
};

export default function TermsOfServicePage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="14 August 2026">
      <section>
        <h2>Agreement</h2>
        <p>
          These terms govern use of Relay CRM (&ldquo;the Service&rdquo;), operated by{" "}
          <code>[LEGAL ENTITY NAME]</code>. By creating a workspace or using the Service you agree
          to them. If you are agreeing on behalf of a company, you confirm you are authorised to
          bind it.
        </p>
      </section>

      <section>
        <h2>The Service</h2>
        <p>
          The Service provides a workspace in which a business can connect its own messaging
          channels, manage customer conversations and records, configure automations, and export its
          data. Each workspace is isolated from every other workspace.
        </p>
        <p>
          Availability of any individual messaging channel depends on the third-party platform that
          provides it and on that platform&rsquo;s approval of your account. We do not control and
          do not guarantee that approval.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          You are responsible for the accuracy of your account details, for keeping credentials
          secure, and for all activity in your workspace. Roles within a workspace carry different
          authority; the workspace owner is responsible for who they grant access to. Notify us at{" "}
          <code>[SUPPORT CONTACT EMAIL]</code> if you believe an account has been compromised.
        </p>
      </section>

      <section>
        <h2>Your data and your customers</h2>
        <p>
          You retain ownership of the data you put into the Service. You grant us the limited right
          to process it in order to operate the Service for you.
        </p>
        <p>
          You are responsible for having a lawful basis to message the people you message, for
          honouring opt-outs, and for complying with the rules of any platform you connect,
          including Meta&rsquo;s policies for WhatsApp, Instagram and Facebook. You are responsible
          for the content of messages sent from your workspace.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You must not use the Service to:</p>
        <ul>
          <li>send unsolicited bulk messages, or message people who have not consented;</li>
          <li>send unlawful, deceptive, harassing or infringing content;</li>
          <li>attempt to access another workspace&rsquo;s data or bypass access controls;</li>
          <li>probe, load-test or disrupt the Service without our written permission;</li>
          <li>resell or provide the Service to a third party except as expressly agreed.</li>
        </ul>
        <p>We may suspend a workspace that we reasonably believe is breaching these rules.</p>
      </section>

      <section>
        <h2>Subscription, trial and payment</h2>
        <p>
          Access to paid features requires an active subscription. Where a trial is offered, its
          length and eligibility are stated at sign-up; trials are limited to one per payment
          instrument. Fees, currency and billing period are as shown at the point of purchase.
        </p>
        <p>
          Subscriptions renew automatically until cancelled. You may cancel at any time;
          cancellation takes effect as described in the billing settings of your workspace. Refunds
          are handled under <code>[REFUND POLICY]</code>, and nothing here limits any statutory
          cancellation right you may have under <code>[GOVERNING LAW]</code>.
        </p>
      </section>

      <section>
        <h2>Third-party platforms</h2>
        <p>
          Connecting a third-party channel is subject to that provider&rsquo;s terms. Those
          providers may change their APIs, pricing, policies or approval status at any time, which
          may reduce or remove functionality through no fault of ours. We are not responsible for a
          third party&rsquo;s acts, outages or decisions.
        </p>
      </section>

      <section>
        <h2>Availability</h2>
        <p>
          We aim to keep the Service available and to give notice of planned maintenance, but except
          where a separate written service-level agreement applies, the Service is provided without
          an uptime guarantee.
        </p>
      </section>

      <section>
        <h2>Disclaimers and liability</h2>
        <p>
          To the maximum extent permitted by law, the Service is provided &ldquo;as is&rdquo;
          without warranties of any kind. Nothing in these terms excludes liability that cannot
          lawfully be excluded, including for death or personal injury caused by negligence, or for
          fraud. Subject to that, our aggregate liability arising out of these terms is limited to{" "}
          <code>[LIABILITY CAP]</code>, and we are not liable for indirect or consequential loss, or
          for loss of profit, revenue or data.
        </p>
      </section>

      <section>
        <h2>Suspension and termination</h2>
        <p>
          You may stop using the Service and delete your workspace at any time; see{" "}
          <a href="/data-deletion">Data Deletion</a>. We may suspend or terminate access for a
          material breach of these terms, for non-payment, or where required by law or by a platform
          we depend on. Where practical we will give notice and an opportunity to export your data.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We may update these terms. Material changes will be notified to workspace owners at their
          registered email address before taking effect. Continuing to use the Service after that
          date means you accept the updated terms.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of <code>[GOVERNING LAW]</code>, and the courts of{" "}
          <code>[JURISDICTION]</code> have exclusive jurisdiction, subject to any mandatory consumer
          protections in your country of residence.
        </p>
        <p>
          Questions about these terms: <code>[SUPPORT CONTACT EMAIL]</code>.
        </p>
      </section>
    </LegalPage>
  );
}
