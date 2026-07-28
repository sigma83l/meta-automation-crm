export type ExportScope =
  | Readonly<{ kind: "one"; customerId: string }>
  | Readonly<{ kind: "selected"; customerIds: readonly string[] }>
  | Readonly<{
      kind: "filtered";
      query?: string | undefined;
      status?: "active" | "archived" | undefined;
    }>
  | Readonly<{ kind: "workspace" }>;

export type ExportAttachment = Readonly<{
  customerId: string;
  originalName: string;
  safeName: string;
  objectPath: string;
  mimeType: string;
  sha256: string;
  bytes: Uint8Array;
}>;

export type ExportDataset = Readonly<{
  workspaceId: string;
  generatedAt: string;
  sheets: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  attachments: readonly ExportAttachment[];
}>;

export interface ExportJobDispatcher {
  dispatch(jobId: string, trustedWorkspaceId: string): Promise<void>;
}
