import { KNOWN_TAGS, snapTag, tidyMerchant } from "@/lib/money-flow/categorize";
import { extensionOf } from "@/lib/money-flow/detect";
import { formatDisplayDate, parseDate, roundMoney } from "@/lib/money-flow/parse-values";
import { tagsOf } from "@/lib/money-flow/tags";
import type { InterpretedTransaction, TransactionType } from "@/lib/money-flow/types";

export type ImageExtractInput = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
};

export type TagSuggestInput = {
  transactions: InterpretedTransaction[];
};

export type AiImageExtract = {
  transactions: InterpretedTransaction[];
  notes: string[];
};

export type AiTagSuggestion = {
  id: string;
  category: string;
  confidence: number;
};

export type MoneyFlowAi = {
  extractFromImage(input: ImageExtractInput): Promise<AiImageExtract>;
  suggestTags(input: TagSuggestInput): Promise<AiTagSuggestion[]>;
};

export type AiEnv = Record<string, string | undefined>;

const TYPES = new Set<TransactionType>(["income", "expense", "transfer", "refund"]);
const VISION_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TAG_BATCH = 40;
const MIN_TAG_CONFIDENCE = 0.45;

export function isAiConfigured(env: AiEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

export function visionMime(filename: string, mime: string): string | null {
  const type = mime.toLowerCase().trim();
  if (VISION_MIMES.has(type)) return type;
  const ext = extensionOf(filename);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

export function createOpenAiFromEnv(
  env: AiEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): MoneyFlowAi | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const url = chatCompletionsUrl(env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1");
  return {
    extractFromImage: (input) => extractWithOpenAi(input, { apiKey, model, url, fetchImpl }),
    suggestTags: (input) => suggestWithOpenAi(input, { apiKey, model, url, fetchImpl }),
  };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(trimmed);
}

export function transactionsFromAiExtract(raw: unknown, sourceFile: string): AiImageExtract {
  const record = asRecord(raw);
  const notes = stringList(record?.notes);
  const rows = Array.isArray(record?.transactions) ? record.transactions : [];
  const transactions = rows.flatMap((row, index) => {
    const item = asRecord(row);
    if (!item) return [];
    const amount = toAmount(item.amount);
    const merchant = tidyMerchant(String(item.merchant ?? item.description ?? "").trim());
    if (amount == null || amount === 0 || merchant === "Unknown") return [];
    const dateIso = parseDate(String(item.date ?? "")) ?? todayIso();
    const type = toType(item.type, amount, String(item.category ?? ""));
    const category = snapTag(String(item.category ?? ""), true);
    const confidence = clamp01(item.confidence) ?? 0.72;
    return [
      {
        id: `${sourceFile}-ai-${index}`,
        merchant,
        category,
        tags: [category],
        tagSource: category === "Other" ? "rules" : "ai",
        extractedBy: "ai",
        date: formatDisplayDate(dateIso),
        dateIso,
        amount: signedAmount(amount, type),
        type,
        sourceFile,
        confidence,
      } satisfies InterpretedTransaction,
    ];
  });
  if (record && typeof record.documentType === "string") {
    notes.unshift(`Read as a ${record.documentType.replace(/_/g, " ")}.`);
  }
  return { transactions, notes };
}

export function needsInitialTag(txn: InterpretedTransaction): boolean {
  return tagsOf(txn).every((tag) => tag === "Other");
}

export function applyTagSuggestions(
  transactions: InterpretedTransaction[],
  suggestions: AiTagSuggestion[],
  minConfidence = MIN_TAG_CONFIDENCE,
): { transactions: InterpretedTransaction[]; taggedCount: number } {
  const byId = new Map(
    suggestions
      .filter((suggestion) => suggestion.confidence >= minConfidence)
      .map((suggestion) => [suggestion.id, suggestion]),
  );
  let taggedCount = 0;
  const next = transactions.map((txn) => {
    if (!needsInitialTag(txn)) return txn;
    const suggestion = byId.get(txn.id);
    if (!suggestion) return txn;
    const category = snapTag(suggestion.category, true);
    if (category === "Other") return txn;
    taggedCount += 1;
    return {
      ...txn,
      category,
      tags: [category],
      tagSource: "ai" as const,
      confidence: Math.max(txn.confidence, suggestion.confidence),
    };
  });
  return { transactions: next, taggedCount };
}

async function extractWithOpenAi(
  input: ImageExtractInput,
  client: OpenAiClient,
): Promise<AiImageExtract> {
  const mime = visionMime(input.filename, input.mime);
  if (!mime) return { transactions: [], notes: ["This image format cannot be sent to AI vision."] };
  const content = await completeJson(client, {
    system: extractSystemPrompt(),
    user: [
      {
        type: "text",
        text: `Extract money movement from this photo named ${input.filename}.`,
      },
      {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${toBase64(input.bytes)}` },
      },
    ],
  });
  return transactionsFromAiExtract(content, input.filename);
}

async function suggestWithOpenAi(input: TagSuggestInput, client: OpenAiClient): Promise<AiTagSuggestion[]> {
  const pending = input.transactions.filter(needsInitialTag);
  const suggestions: AiTagSuggestion[] = [];
  for (let i = 0; i < pending.length; i += TAG_BATCH) {
    const batch = pending.slice(i, i + TAG_BATCH).map((txn) => ({
      id: txn.id,
      merchant: txn.merchant,
      amount: txn.amount,
      type: txn.type,
      date: txn.dateIso,
    }));
    const content = await completeJson(client, {
      system: tagSystemPrompt(),
      user: [{ type: "text", text: JSON.stringify({ transactions: batch }) }],
    });
    suggestions.push(...suggestionsFromModel(content));
  }
  return suggestions;
}

function suggestionsFromModel(raw: unknown): AiTagSuggestion[] {
  const record = asRecord(raw);
  const rows = Array.isArray(record?.suggestions) ? record.suggestions : Array.isArray(raw) ? raw : [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    if (!item || typeof item.id !== "string" || typeof item.category !== "string") return [];
    return [{ id: item.id, category: item.category, confidence: clamp01(item.confidence) ?? 0.5 }];
  });
}

async function completeJson(
  client: OpenAiClient,
  prompt: { system: string; user: Array<Record<string, unknown>> },
): Promise<unknown> {
  const response = await client.fetchImpl(client.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${client.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: client.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`AI request failed (${response.status}).`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI returned an empty response.");
  }
  return parseModelJson(content);
}

function extractSystemPrompt(): string {
  return [
    "You extract money movement from photos of receipts, invoices, and bank statements for an Australian personal-finance app.",
    "Reply with JSON only:",
    '{ "documentType": "receipt" | "statement" | "invoice" | "other", "transactions": [{ "date": "YYYY-MM-DD", "merchant": "string", "description": "string", "amount": -12.5, "type": "expense" | "income" | "transfer" | "refund", "category": "Groceries", "confidence": 0.86 }], "notes": ["short note"] }',
    "Amounts are AUD. Expenses and transfers out are negative. Income and refunds are positive.",
    "A shop receipt is usually ONE expense for the total paid, not every line item.",
    "A bank or card statement photo should list each transaction row.",
    `Use only these category tags when possible: ${KNOWN_TAGS.join(", ")}.`,
    "Do not invent amounts, dates, or merchants you cannot see.",
    "If the photo is not a financial document, return an empty transactions array.",
  ].join("\n");
}

function tagSystemPrompt(): string {
  return [
    "You assign an initial tag when rule-based matching could not.",
    `Allowed tags: ${KNOWN_TAGS.join(", ")}.`,
    'Reply with JSON only: { "suggestions": [{ "id": "txn-id", "category": "Dining", "confidence": 0.8 }] }',
    "If you are not reasonably sure, use Other with low confidence.",
    "Prefer a specific tag over Other when the merchant is recognisable.",
  ].join("\n");
}

function chatCompletionsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? roundMoney(parsed) : null;
  }
  return null;
}

function toType(value: unknown, amount: number, category: string): TransactionType {
  if (typeof value === "string" && TYPES.has(value as TransactionType)) return value as TransactionType;
  if (/\brefund|reversal|rebate\b/i.test(category)) return "refund";
  if (category.toLowerCase() === "goals" || /\btransfer\b/i.test(category)) return "transfer";
  if (amount > 0 || category.toLowerCase() === "income") return "income";
  return "expense";
}

function signedAmount(amount: number, type: TransactionType): number {
  if (type === "income" || type === "refund") return Math.abs(amount);
  return amount > 0 ? -amount : amount;
}

function clamp01(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type OpenAiClient = {
  apiKey: string;
  model: string;
  url: string;
  fetchImpl: typeof fetch;
};
