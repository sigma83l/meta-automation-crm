export const platformAdminModule = Object.freeze({ id: "platform-admin", stage: "platform" });
export {
  capabilitiesFor,
  platformAdminRoles,
  platformCapabilities,
  roleAllows,
  IMPERSONATION_MAX_MINUTES
} from "./contracts";
export type {
  FeatureFlagState,
  ImpersonationGrant,
  PlatformAdmin,
  PlatformAdminRole,
  PlatformAuditRow,
  PlatformCapability,
  PlatformOverview,
  PlatformSwitch,
  PlatformUserRow,
  WorkspaceDetail,
  WorkspaceRow
} from "./contracts";
