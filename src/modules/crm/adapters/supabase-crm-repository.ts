import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { CrmRepository, CustomerFilters, CustomerInput, CustomerSummary } from "../contracts";

const inputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(120).nullable().optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(3).max(40).optional()
});

export class SupabaseCrmRepository implements CrmRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly workspace: TrustedWorkspace
  ) {}

  async list(filters: CustomerFilters) {
    let query = this.client
      .from("customers")
      .select("id,display_name,company_name,status,source,created_at")
      .eq("workspace_id", this.workspace.id)
      .order("updated_at", { ascending: false })
      .limit(250);
    if (filters.query) {
      const safe = filters.query.replaceAll(/[,%()]/g, "").slice(0, 80);
      query = query.or(`display_name.ilike.%${safe}%,company_name.ilike.%${safe}%`);
    }
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapCustomer);
  }

  async create(raw: CustomerInput) {
    const input = inputSchema.parse(raw);
    const { data, error } = await this.client
      .from("customers")
      .insert({
        workspace_id: this.workspace.id,
        display_name: input.displayName,
        company_name: input.companyName ?? null,
        created_by: this.workspace.userId
      })
      .select("id,display_name,company_name,status,source,created_at")
      .single();
    if (error) throw error;
    const contacts = [
      ...(input.email ? [{ kind: "email", value: input.email, is_primary: true }] : []),
      ...(input.phone ? [{ kind: "phone", value: input.phone, is_primary: !input.email }] : [])
    ];
    if (contacts.length) {
      const { error: contactError } = await this.client.from("customer_contact_methods").insert(
        contacts.map((contact) => ({
          ...contact,
          workspace_id: this.workspace.id,
          customer_id: data.id
        }))
      );
      if (contactError) {
        await this.client.from("customers").delete().eq("id", data.id);
        throw contactError;
      }
    }
    await this.activity(data.id, "customer.created", `Customer ${input.displayName} created`);
    await this.audit(data.id, "crm.customer.created");
    return mapCustomer(data);
  }

  async update(customerId: string, raw: CustomerInput) {
    const input = inputSchema.parse(raw);
    const { data, error } = await this.client
      .from("customers")
      .update({
        display_name: input.displayName,
        company_name: input.companyName ?? null,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", this.workspace.id)
      .eq("id", customerId)
      .select("id,display_name,company_name,status,source,created_at")
      .single();
    if (error) throw error;
    await this.activity(customerId, "customer.updated", `Customer ${input.displayName} updated`);
    await this.audit(customerId, "crm.customer.updated");
    return mapCustomer(data);
  }

  async detail(customerId: string): Promise<Readonly<Record<string, unknown>>> {
    const customer = await this.client
      .from("customers")
      .select("*")
      .eq("workspace_id", this.workspace.id)
      .eq("id", customerId)
      .single();
    if (customer.error) throw customer.error;
    const tables = [
      "customer_channel_identities",
      "customer_contact_methods",
      "customer_consents",
      "customer_notes",
      "customer_activities",
      "conversations",
      "customer_files",
      "customer_automation_references",
      "crm_audit_events"
    ] as const;
    const results = await Promise.all(
      tables.map((table) =>
        this.client
          .from(table)
          .select("*")
          .eq("workspace_id", this.workspace.id)
          .eq("customer_id", customerId)
      )
    );
    return Object.freeze({
      customer: customer.data,
      identities: results[0]!.data ?? [],
      contacts: results[1]!.data ?? [],
      consents: results[2]!.data ?? [],
      notes: results[3]!.data ?? [],
      timeline: results[4]!.data ?? [],
      conversations: results[5]!.data ?? [],
      files: results[6]!.data ?? [],
      automations: results[7]!.data ?? [],
      audit: results[8]!.data ?? []
    });
  }

  private async activity(customerId: string, activityType: string, summary: string) {
    const { error } = await this.client.from("customer_activities").insert({
      workspace_id: this.workspace.id,
      customer_id: customerId,
      activity_type: activityType,
      summary
    });
    if (error) throw error;
  }

  private async audit(customerId: string, action: string) {
    const { error } = await this.client.from("crm_audit_events").insert({
      workspace_id: this.workspace.id,
      actor_user_id: this.workspace.userId,
      customer_id: customerId,
      action
    });
    if (error) throw error;
  }
}

function mapCustomer(row: Record<string, unknown>): CustomerSummary {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    companyName: row.company_name ? String(row.company_name) : null,
    status: row.status as "active" | "archived",
    source: String(row.source),
    createdAt: String(row.created_at)
  };
}
