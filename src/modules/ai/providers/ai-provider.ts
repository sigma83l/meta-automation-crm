import type { Result } from "@/src/lib/result";

export type AiReplyInput = Readonly<{
  workspaceId: string;
  conversationId: string;
  language: string;
  customerMessage: string;
  approvedKnowledge: readonly string[];
}>;

export type AiReply = Readonly<{
  intent: string;
  language: string;
  reply: string;
  confidence: number;
  needsHuman: boolean;
  synthetic: boolean;
}>;

export interface AiProvider {
  readonly name: string;
  generateStructuredReply(input: AiReplyInput): Promise<Result<AiReply>>;
  testConnection(): Promise<Result<{ available: boolean; synthetic: boolean }>>;
}
