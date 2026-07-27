import { aiModule } from "@/src/modules/ai";
import { auditModule } from "@/src/modules/audit";
import { authModule } from "@/src/modules/auth";
import { automationsModule } from "@/src/modules/automations";
import { businessProfileModule } from "@/src/modules/business-profile";
import { conversationsModule } from "@/src/modules/conversations";
import { crmModule } from "@/src/modules/crm";
import { exportsModule } from "@/src/modules/exports";
import { integrationsModule } from "@/src/modules/integrations";
import { workspacesModule } from "@/src/modules/workspaces";

export const foundationModules = Object.freeze([
  authModule,
  workspacesModule,
  businessProfileModule,
  crmModule,
  conversationsModule,
  automationsModule,
  integrationsModule,
  aiModule,
  exportsModule,
  auditModule
]);
