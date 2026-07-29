import { z } from "zod";

import type { ServerEnvironment } from "@/src/lib/env";
import type { MetaChannel } from "./contracts";

type Fetcher = typeof fetch;

const tokenResponseSchema = z.object({
  access_token: z.string().min(16),
  user_id: z.union([z.string(), z.number()]).optional()
});
const instagramAccountSchema = z.object({
  id: z.union([z.string(), z.number()]),
  username: z.string().min(1).max(120).optional()
});
const whatsappPhonesSchema = z.object({
  data: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      display_phone_number: z.string().min(1).max(80).optional()
    })
  )
});

export type LiveMetaExchangeInput = Readonly<{
  channel: MetaChannel;
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
}>;

export type VerifiedLiveMetaCredential = Readonly<{
  accessToken: string;
  providerAccountId: string;
  displayName: string;
  permissions: readonly string[];
  wabaId?: string;
  phoneNumberId?: string;
  instagramAccountId?: string;
}>;

export async function exchangeAndVerifyMetaCredential(
  input: LiveMetaExchangeInput,
  environment: ServerEnvironment,
  fetcher: Fetcher = fetch
): Promise<VerifiedLiveMetaCredential> {
  if (
    environment.metaConnectionMode !== "live" ||
    !environment.metaAppId ||
    !environment.metaAppSecret ||
    !environment.metaOauthRedirectUrl ||
    !environment.metaGraphApiVersion ||
    !/^[A-Za-z0-9_-]{8,2048}$/.test(input.code)
  ) {
    throw new Error("META_LIVE_CONFIGURATION_REQUIRED");
  }
  const token =
    input.channel === "instagram"
      ? await exchangeInstagramCode(input.code, environment, fetcher)
      : await exchangeWhatsappCode(input.code, environment, fetcher);
  return input.channel === "instagram"
    ? verifyInstagramAccount(token, environment, fetcher)
    : verifyWhatsappAccount(token, input, environment, fetcher);
}

async function exchangeInstagramCode(
  code: string,
  environment: ServerEnvironment,
  fetcher: Fetcher
) {
  const body = new URLSearchParams({
    client_id: environment.metaAppId!,
    client_secret: environment.metaAppSecret!,
    grant_type: "authorization_code",
    redirect_uri: environment.metaOauthRedirectUrl!,
    code
  });
  return requestToken("https://api.instagram.com/oauth/access_token", body, fetcher);
}

async function exchangeWhatsappCode(
  code: string,
  environment: ServerEnvironment,
  fetcher: Fetcher
) {
  const body = new URLSearchParams({
    client_id: environment.metaAppId!,
    client_secret: environment.metaAppSecret!,
    redirect_uri: environment.metaOauthRedirectUrl!,
    code
  });
  return requestToken(
    `https://graph.facebook.com/${environment.metaGraphApiVersion!}/oauth/access_token`,
    body,
    fetcher
  );
}

async function requestToken(url: string, body: URLSearchParams, fetcher: Fetcher) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error("META_CODE_EXCHANGE_FAILED");
  return tokenResponseSchema.parse(await response.json()).access_token;
}

async function verifyInstagramAccount(
  accessToken: string,
  environment: ServerEnvironment,
  fetcher: Fetcher
): Promise<VerifiedLiveMetaCredential> {
  const response = await graphGet(
    `https://graph.instagram.com/${environment.metaGraphApiVersion!}/me?fields=id,username`,
    accessToken,
    fetcher
  );
  const account = instagramAccountSchema.parse(await response.json());
  const id = String(account.id);
  return {
    accessToken,
    providerAccountId: id,
    displayName: account.username ?? `Instagram ${id.slice(-4)}`,
    permissions: ["instagram_business_basic", "instagram_business_manage_messages"],
    instagramAccountId: id
  };
}

async function verifyWhatsappAccount(
  accessToken: string,
  input: LiveMetaExchangeInput,
  environment: ServerEnvironment,
  fetcher: Fetcher
): Promise<VerifiedLiveMetaCredential> {
  if (
    !input.wabaId ||
    !input.phoneNumberId ||
    !/^\d{5,40}$/.test(input.wabaId) ||
    !/^\d{5,40}$/.test(input.phoneNumberId)
  ) {
    throw new Error("META_WHATSAPP_ASSET_REQUIRED");
  }
  const response = await graphGet(
    `https://graph.facebook.com/${environment.metaGraphApiVersion!}/${input.wabaId}/phone_numbers?fields=id,display_phone_number`,
    accessToken,
    fetcher
  );
  const phones = whatsappPhonesSchema.parse(await response.json());
  const phone = phones.data.find((candidate) => String(candidate.id) === input.phoneNumberId);
  if (!phone) throw new Error("META_WHATSAPP_ASSET_MISMATCH");
  return {
    accessToken,
    providerAccountId: input.phoneNumberId,
    displayName: phone.display_phone_number ?? `WhatsApp ${input.phoneNumberId.slice(-4)}`,
    permissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId
  };
}

async function graphGet(url: string, accessToken: string, fetcher: Fetcher) {
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error("META_ASSET_VERIFICATION_FAILED");
  return response;
}
