import { PrismaClient } from "@prisma/client";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { ChatMessage, LLMClient, LLMResponse, ToolDefinition } from "@/services/ai/llm";
import { MockWhatsAppService, setWhatsAppService } from "@/services/whatsapp";
import { setLLMClient } from "@/services/ai";

export const prisma = new PrismaClient();

const TABLES = [
  "audit_logs", "part_requests", "quotation_labour", "quotation_items", "quotations", "quote_sequences", "messages",
  "conversations", "vehicle_fitment", "labour_rates", "parts", "vehicles", "customers", "users", "businesses",
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function resetAndSeed(): Promise<SeedResult> {
  await resetDb();
  return seedDemo(prisma);
}

export function useMockWhatsApp(): MockWhatsAppService {
  const wa = new MockWhatsAppService();
  setWhatsAppService(wa);
  return wa;
}

export type ScriptFn = (call: { n: number; system: string; messages: ChatMessage[]; tools: ToolDefinition[] }) => LLMResponse;

export class ScriptedLLM implements LLMClient {
  readonly name = "scripted";
  calls = 0;
  constructor(private readonly script: ScriptFn) {}
  async complete(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse> {
    this.calls += 1;
    return this.script({ n: this.calls, ...params });
  }
}

export const say = (content: string): LLMResponse => ({ content, toolCalls: [] });
export const call = (name: string, args: Record<string, unknown>, id = `call_${name}_${Math.random().toString(36).slice(2, 7)}`): LLMResponse => ({
  content: null,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

export function installLLM(llm: LLMClient | null) {
  setLLMClient(llm);
}

export function waPayload(opts: { phoneNumberId: string; from: string; id: string; text: string; name?: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27115550100", phone_number_id: opts.phoneNumberId },
              contacts: [{ profile: { name: opts.name ?? "Test User" }, wa_id: opts.from }],
              messages: [{ from: opts.from, id: opts.id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: opts.text } }],
            },
          },
        ],
      },
    ],
  };
}
