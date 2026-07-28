import { appError, err, type Result } from "@/src/lib/result";
import type { AiMode, AiProvider } from "./contracts";

export type AiProviderSet = Readonly<{
  platform: AiProvider;
  gemini?: AiProvider;
  openai?: AiProvider;
  anthropic?: AiProvider;
  freeGeminiDemo?: AiProvider;
}>;

export function selectAiProvider(mode: AiMode, providers: AiProviderSet): Result<AiProvider> {
  const selected =
    mode === "PLATFORM_PAID_DEFAULT"
      ? providers.platform
      : mode === "WORKSPACE_BYOK_GEMINI"
        ? providers.gemini
        : mode === "WORKSPACE_BYOK_OPENAI"
          ? providers.openai
          : mode === "WORKSPACE_BYOK_ANTHROPIC"
            ? providers.anthropic
            : providers.freeGeminiDemo;
  return selected
    ? { ok: true, value: selected }
    : err(appError("AI_CREDENTIAL_UNAVAILABLE", "The selected AI provider is unavailable."));
}
