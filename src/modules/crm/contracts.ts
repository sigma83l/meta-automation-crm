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

export interface CrmRepository {
  list(filters: CustomerFilters): Promise<readonly CustomerSummary[]>;
  create(input: CustomerInput): Promise<CustomerSummary>;
  update(customerId: string, input: CustomerInput): Promise<CustomerSummary>;
  detail(customerId: string): Promise<Readonly<Record<string, unknown>>>;
}
