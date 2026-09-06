"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import type { StoredActionProposal } from "../contracts";
import { NEXT_ACTION_LABELS } from "./vocabulary";

/**
 * Suggestions waiting on a person.
 *
 * The derived next action is on the Now card and needs no answer - it is what
 * current state implies, and it changes when the state does. These are the
 * other kind: something a model or a person proposed at a time, which stays
 * until somebody takes it on or turns it down.
 *
 * Accepting does not perform anything. The CRM proposes and the domain that
 * owns the send executes, so what a click records is that a person answered -
 * and a rejected suggestion is kept, because a pattern of bad ones is only
 * visible if the bad ones survive.
 */
export function ProposalsPanel({ proposals }: { proposals: readonly StoredActionProposal[] }) {
  const { text, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  if (proposals.length === 0) return null;

  async function settle(id: string, outcome: "accepted" | "rejected") {
    setBusy(id);
    const csrf = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    await fetch(`/api/crm/proposals/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
      body: JSON.stringify({ outcome })
    });
    setBusy("");
    router.refresh();
  }

  return (
    <section className="proposal-panel" aria-label={text("Suggestions", "Öneriler", "پیشنهادها")}>
      <span className="eyebrow">{text("Suggested", "Önerilen", "پیشنهادشده")}</span>
      <ul>
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <strong>{text(...NEXT_ACTION_LABELS[proposal.type])}</strong>
            <span className="status-pill">{proposal.source}</span>
            <small>
              {proposal.reasonCodes.join(", ") || "—"} ·{" "}
              <time dateTime={proposal.proposedAt}>
                {when.format(new Date(proposal.proposedAt))}
              </time>
              {proposal.confidence < 1
                ? ` · ${Math.round(proposal.confidence * 100)}% ${text("confidence", "güven", "اطمینان")}`
                : ""}
            </small>
            <div className="proposal-actions">
              <button
                type="button"
                disabled={busy === proposal.id}
                onClick={() => void settle(proposal.id, "accepted")}
              >
                {text("Take this on", "Bunu üstlen", "این را بپذیر")}
              </button>
              <button
                type="button"
                className="button-text"
                disabled={busy === proposal.id}
                onClick={() => void settle(proposal.id, "rejected")}
              >
                {text("Not this", "Bu değil", "این نه")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
