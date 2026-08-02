import { z } from "zod";

type Fetcher = typeof fetch;

const templateSchema = z.object({
  data: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string().min(1).max(512),
      language: z.string().min(2).max(35),
      status: z.enum(["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"])
    })
  )
});

export type WhatsappTemplateInventoryItem = Readonly<{
  id: string;
  name: string;
  language: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";
}>;

export async function fetchWhatsappTemplateInventory(
  input: {
    graphVersion: string;
    wabaId: string;
    accessToken: string;
  },
  fetcher: Fetcher = fetch
): Promise<readonly WhatsappTemplateInventoryItem[]> {
  if (
    !/^v\d{1,2}\.\d{1,2}$/.test(input.graphVersion) ||
    !/^\d{5,40}$/.test(input.wabaId) ||
    input.accessToken.length < 16
  ) {
    throw new Error("META_TEMPLATE_CONFIGURATION_REQUIRED");
  }
  const response = await fetcher(
    `https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/message_templates?fields=id,name,language,status&limit=250`,
    {
      headers: { authorization: `Bearer ${input.accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    }
  );
  if (!response.ok) throw new Error("META_TEMPLATE_SYNC_FAILED");
  return templateSchema.parse(await response.json()).data.map((item) => ({
    ...item,
    id: String(item.id)
  }));
}
