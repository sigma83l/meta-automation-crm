import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import {
  SimulationUnavailableError,
  simulateAutomationTurn
} from "@/src/modules/automations/server/simulation";
import { simulationRequestSchema } from "@/src/modules/automations/simulation-contracts";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { billingBlockedResponse } from "@/src/modules/billing/http";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const parsed = simulationRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "SIMULATION_INPUT_INVALID" }, { status: 400 });
    }
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(await simulateAutomationTurn(workspace, parsed.data));
  } catch (error) {
    // A workspace that cannot be simulated is not a failed request: the
    // operator needs to be told which precondition is missing, not shown a
    // generic error they cannot act on.
    if (error instanceof SimulationUnavailableError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    return billingBlockedResponse(error, "SIMULATION_FAILED", 400);
  }
}
