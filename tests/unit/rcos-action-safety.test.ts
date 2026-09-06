import { describe, expect, it } from "vitest";
import {
  ACTION_CLASSES,
  authorizeAction,
  mayClaimSuccess,
  requirementsFor,
  type ActionAttempt,
  type ActionClass
} from "@/src/modules/rcos/action-safety";

const attempt = (over: Partial<ActionAttempt> = {}): ActionAttempt => ({
  actionClass: "read_only",
  allowedActions: ["read", "create_task", "book_slot", "refund", "delete_workspace"],
  actionName: "read",
  hasIdempotencyKey: false,
  hasHumanApproval: false,
  hasAuthoritativeResult: false,
  ...over
});

describe("policy is the outer bound", () => {
  it("refuses any action the workspace policy did not list", () => {
    // A model naming an action outside the granted set is attempting to widen
    // its own permissions, which must fail regardless of how safe the class is.
    const verdict = authorizeAction(attempt({ actionName: "send_invoice" }));
    expect(verdict).toMatchObject({ permitted: false, reason: "action not permitted by policy" });
  });

  it("refuses even a read when policy omits it", () => {
    expect(authorizeAction(attempt({ allowedActions: [] }))).toMatchObject({ permitted: false });
  });
});

describe("autonomy by action class", () => {
  it("lets the model read without ceremony", () => {
    expect(authorizeAction(attempt())).toEqual({ permitted: true, audited: false });
  });

  it("lets the model take reversible actions but records them", () => {
    const verdict = authorizeAction(
      attempt({ actionClass: "reversible_low_risk", actionName: "create_task" })
    );
    expect(verdict).toEqual({ permitted: true, audited: true });
  });

  it("requires an idempotency key before any business transaction", () => {
    // Without one, a retry books the slot twice.
    expect(
      authorizeAction(attempt({ actionClass: "business_transaction", actionName: "book_slot" }))
    ).toMatchObject({ permitted: false, reason: "idempotency key required" });
  });

  it("allows a business transaction that carries its key", () => {
    expect(
      authorizeAction(
        attempt({
          actionClass: "business_transaction",
          actionName: "book_slot",
          hasIdempotencyKey: true
        })
      )
    ).toEqual({ permitted: true, audited: true });
  });

  it.each(["sensitive_exception", "destructive"] as const)(
    "never lets the model perform %s alone",
    (actionClass) => {
      const name = actionClass === "destructive" ? "delete_workspace" : "refund";
      expect(
        authorizeAction(attempt({ actionClass, actionName: name, hasIdempotencyKey: true }))
      ).toMatchObject({ permitted: false, reason: "human approval required" });
    }
  );

  it("permits a destructive action once a human has approved and a key is present", () => {
    expect(
      authorizeAction(
        attempt({
          actionClass: "destructive",
          actionName: "delete_workspace",
          hasIdempotencyKey: true,
          hasHumanApproval: true
        })
      )
    ).toEqual({ permitted: true, audited: true });
  });
});

describe("claiming success", () => {
  it("never claims a transaction succeeded without an authoritative result", () => {
    // The fail-safe: saying "you're booked" on the strength of the model's own
    // output is exactly what this prevents.
    expect(
      mayClaimSuccess(attempt({ actionClass: "business_transaction", actionName: "book_slot" }))
    ).toBe(false);
  });

  it("claims success once an authoritative system has confirmed", () => {
    expect(
      mayClaimSuccess(
        attempt({
          actionClass: "business_transaction",
          actionName: "book_slot",
          hasAuthoritativeResult: true
        })
      )
    ).toBe(true);
  });

  it("allows stating the result of a read, which needs no confirmation", () => {
    expect(mayClaimSuccess(attempt())).toBe(true);
  });
});

describe("classification is exhaustive and fails closed", () => {
  it("defines requirements for every declared class", () => {
    for (const actionClass of ACTION_CLASSES) {
      expect(`${actionClass}:${typeof requirementsFor(actionClass)}`).toBe(`${actionClass}:object`);
    }
  });

  it("refuses an unrecognised class rather than defaulting to permitted", () => {
    const rogue = attempt({ actionClass: "made_up" as ActionClass, actionName: "read" });
    expect(authorizeAction(rogue)).toMatchObject({ permitted: false });
    expect(mayClaimSuccess(rogue)).toBe(false);
  });

  it("never marks a human-approval class as autonomous", () => {
    for (const actionClass of ACTION_CLASSES) {
      const requirement = requirementsFor(actionClass);
      if (requirement.humanApproval) {
        expect(`${actionClass}:${requirement.autonomous}`).toBe(`${actionClass}:false`);
      }
    }
  });

  it("audits everything that is not a plain read", () => {
    for (const actionClass of ACTION_CLASSES) {
      if (actionClass === "read_only") continue;
      expect(`${actionClass}:${requirementsFor(actionClass).audited}`).toBe(`${actionClass}:true`);
    }
  });
});
