export type CustomerSummary = Readonly<{
  id: string;
  displayName: string;
  companyName: string | null;
  status: "active" | "archived";
  source: string;
  createdAt: string;
}>;

export type CustomerInput = Readonly<{
  displayName: string;
  companyName?: string | null;
  email?: string;
  phone?: string;
}>;

export type CustomerFilters = Readonly<{
  query?: string;
  status?: "active" | "archived";
}>;

/**
 * One reason a customer scores the way they do.
 *
 * `evidenceRef` is required and `QualificationSignal` in revenue-state.ts leaves
 * it optional. The stricter shape is the one that gets stored: the pack's rule
 * is that every non-zero contribution maps to evidence, and a stored row is
 * exactly where an unsourced weight would become permanent. The pure scorer can
 * stay lenient because it computes and forgets; this does not.
 */
export type EvidenceInput = Readonly<{
  customerId: string;
  /** What was observed, from the workspace's signal vocabulary. */
  signal: string;
  /** -100..100. Negative weights are disqualifiers. */
  weight: number;
  confidence: "inferred" | "high_confidence" | "confirmed" | "human_verified";
  /** Message, note or actor this came from. Never empty. */
  evidenceRef: string;
}>;

export type StoredEvidence = EvidenceInput & Readonly<{ id: string; recordedAt: string }>;

export interface CrmRepository {
  list(filters: CustomerFilters): Promise<readonly CustomerSummary[]>;
  create(input: CustomerInput): Promise<CustomerSummary>;
  update(customerId: string, input: CustomerInput): Promise<CustomerSummary>;
  detail(customerId: string): Promise<Readonly<Record<string, unknown>>>;
  /** Appends one piece of evidence. Evidence is never edited, only superseded. */
  recordEvidence(input: EvidenceInput): Promise<StoredEvidence>;
  /** Every recorded signal for one customer, newest first. */
  evidenceFor(customerId: string): Promise<readonly StoredEvidence[]>;
}
