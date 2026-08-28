import { NextResponse, type NextRequest } from "next/server";

import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { billingBlockedResponse } from "@/src/modules/billing/http";

/**
 * A person answering a suggestion.
 *
 * `11_MANUAL_AND_AI_COLLABORATION.md` lists accepting and rejecting an AI
 * update among the things a human does, and the projection has kept the outcome
 * column for it since the next-action work. Accepting records that somebody
 * took the suggestion on - it does not perform it, because the CRM proposes and
 * the domain that owns the send executes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as { outcome?: unknown };
    const outcome = body.outcome;
    if (outcome !== "accepted" && outcome !== "rejected") {
      // `superseded` is the engine's word for a proposal a newer one replaced,
      // not something a person chooses.
      return NextResponse.json({ error: "INVALID_OUTCOME" }, { status: 400 });
    }
    const { repository } = await createCrmRuntime();
    const { id } = await params;
    return NextResponse.json({ proposal: await repository.settleProposal(id, outcome) });
  } catch (error) {
    return billingBlockedResponse(error, "PROPOSAL_NOT_SETTLED", 400);
  }
}
