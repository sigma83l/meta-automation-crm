export const PRIVATE_CRM_BUCKET = "crm-private" as const;

export const WORKSPACE_OWNED_TABLE_REQUIREMENTS = Object.freeze({
  workspaceColumn: "workspace_id",
  rowLevelSecurity: "required",
  defaultPolicy: "deny",
  serviceRoleLocation: "server-only"
} as const);

export type SupabaseCapability = "auth" | "postgres" | "private-storage";

export type SupabaseFoundationContract = Readonly<{
  capabilities: readonly SupabaseCapability[];
  privateBucket: typeof PRIVATE_CRM_BUCKET;
  migrationsApplied: false;
}>;

export const supabaseFoundationContract: SupabaseFoundationContract = Object.freeze({
  capabilities: Object.freeze<SupabaseCapability[]>(["auth", "postgres", "private-storage"]),
  privateBucket: PRIVATE_CRM_BUCKET,
  migrationsApplied: false
});
