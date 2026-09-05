import { KNOWN_CATEGORIES, snapCategory, tidyMerchant } from "@/lib/money-flow/categorize";
import { extensionOf } from "@/lib/money-flow/detect";
import { formatDisplayDate, parseDate, roundMoney } from "@/lib/money-flow/parse-values";
import { personalWords, redactMovement } from "@/lib/money-flow/redact";
import { inflowType, isTransactionType, typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

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
  /** A taxonomy key. Anything outside it is dropped rather than invented into existence. */
  category: string;
  confidence: number;
};

export type MoneyFlowAi = {
  extractFromImage(input: ImageExtractInput): Promise<AiImageExtract>;
  suggestTags(input: TagSuggestInput): Promise<AiTagSuggestion[]>;
};

export type AiEnv = Record<string, string | undefined>;

const VISION_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TAG_BATCH = 40;

/**
 * How sure a model has to be before its answer is used, by how much money is riding on it.
 *
 * A wrong category on a $13 lunch is a rounding error in a report. A wrong category on
 * $24,800 moves the year, and the sample statements contain exactly that row. So the bar
 * rises with the amount: below it the movement stays in the review queue, where a person
 * decides in one click, rather than being quietly filed somewhere plausible.
 *
 * Tuned by moving the small-amount floor first once there is correction-rate data: it is
 * the one that decides how much of a first import gets placed automatically.
 */
const CONFIDENCE_NEEDED: Array<[atLeast: number, confidence: number]> = [
  [1000, 0.85],
  [200, 0.7],
  [0, 0.55],
];

export function confidenceNeededFor(amount: number): number {
  const size = Math.abs(amount);
  return CONFIDENCE_NEEDED.find(([atLeast]) => size >= atLeast)?.[1] ?? 0.55;
}

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
    const categoryKey = snapCategory(String(item.category ?? "")) ?? UNCATEGORISED;
    const signed = signedAmount(amount, item.type);
    const confidence = clamp01(item.confidence) ?? 0.72;
    return [
      {
        id: `${sourceFile}-ai-${index}`,
        merchant,
        categoryKey,
        // The type is worked out from the category and the direction rather than taken
        // from the model, so a model that answers "income" for a payment cannot put a
        // negative number in the earnings figure.
        type: typeForCategory(categoryKey, signed),
        decidedBy: categoryKey === UNCATEGORISED ? ("unreviewed" as const) : ("ai" as const),
        extractedBy: "ai",
        date: formatDisplayDate(dateIso),
        dateIso,
        amount: signed,
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

/**
 * Whether the model is worth asking about this movement at all.
 *
 * Only the ones nothing else could settle. A movement the rules recognised, a person
 * corrected, or a pair proved is already decided by something cheaper and more reliable
 * than a model call, and asking anyway is how a confident wrong answer overwrites a right
 * one.
 */
export function needsInitialTag(txn: InterpretedTransaction): boolean {
  return txn.categoryKey === UNCATEGORISED;
}

export function applyTagSuggestions(
  transactions: InterpretedTransaction[],
  suggestions: AiTagSuggestion[],
  floor = 0,
): { transactions: InterpretedTransaction[]; taggedCount: number } {
  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));
  let taggedCount = 0;
  const next = transactions.map((txn) => {
    if (!needsInitialTag(txn)) return txn;
    const suggestion = byId.get(txn.id);
    if (!suggestion) return txn;
    // The bar this movement has to clear, not a bar for the batch: the same answer that is
    // good enough for a coffee is not good enough for a mortgage payment.
    if (suggestion.confidence < Math.max(floor, confidenceNeededFor(txn.amount))) return txn;
    const categoryKey = snapCategory(suggestion.category);
    // A model naming something outside the taxonomy has told us nothing usable, and the
    // movement stays in the review queue rather than picking up an invented category.
    if (!categoryKey || categoryKey === UNCATEGORISED) return txn;
    taggedCount += 1;
    return {
      ...txn,
      categoryKey,
      type: typeForCategory(categoryKey, txn.amount),
      decidedBy: "ai" as const,
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
  // Worked out over the whole ledger rather than per batch, because a name is only
  // recognisable as a name by how often it turns up across all of it.
  const personal = personalWords(input.transactions);
  const suggestions: AiTagSuggestion[] = [];
  for (let i = 0; i < pending.length; i += TAG_BATCH) {
    const batch = pending.slice(i, i + TAG_BATCH).flatMap((txn) => {
      const merchant = redactMovement(txn, personal);
      // Nothing recognisable survived redaction — the descriptor was a reference number
      // and a name. There is no question to ask, so none is asked.
      if (!merchant) return [];
      return [{
        id: txn.id,
        merchant,
        // Rounded, because the exact cents identify a person's movement and the size is
        // all the model needs to tell a coffee from a rent payment.
        amount: Math.round(txn.amount),
        date: txn.dateIso.slice(0, 7),
      }];
    });
    if (batch.length === 0) continue;
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
    '{ "documentType": "receipt" | "statement" | "invoice" | "other", "transactions": [{ "date": "YYYY-MM-DD", "merchant": "string", "description": "string", "amount": -12.5, "type": "expense" | "income" | "transfer" | "refund", "category": "food.groceries", "confidence": 0.86 }], "notes": ["short note"] }',
    "Amounts are AUD. Expenses and transfers out are negative. Income and refunds are positive.",
    "A shop receipt is usually ONE expense for the total paid, not every line item.",
    "A bank or card statement photo should list each transaction row.",
    `Use only these category keys: ${KNOWN_CATEGORIES.join(", ")}.`,
    "Do not invent amounts, dates, or merchants you cannot see.",
    "If the photo is not a financial document, return an empty transactions array.",
  ].join("\n");
}

function tagSystemPrompt(): string {
  return [
    "You assign a category to an Australian bank movement that no rule recognised. Answer with the category key only; the app works out whether it was earned, spent, borrowed or moved from the key and the direction, so never say.",
    "Descriptors have had names, account numbers and reference numbers stripped out. Do not ask for them and do not guess at them.",
    `Allowed category keys, and nothing else: ${KNOWN_CATEGORIES.join(", ")}.`,
    'Reply with JSON only: { "suggestions": [{ "id": "txn-id", "category": "food.restaurants", "confidence": 0.8 }] }',
    "If you are not reasonably sure, answer uncategorised with low confidence. A wrong category is worse than none: an unsorted movement is asked about, a wrong one is not.",
    "Prefer the most specific key you are sure of. A group on its own, such as transport, is a fine answer when the child is a guess.",
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

/**
 * The direction a model meant, which is the only part of its type answer worth keeping.
 *
 * What kind of movement it is follows from the category and the sign, so the model never
 * gets to put a figure in the wrong column by naming a type. It is still asked for one,
 * because on a photo of a receipt the model is the only thing that can see whether money
 * came or went.
 */
function signedAmount(amount: number, type: unknown): number {
  const named = String(type ?? "");
  const arriving = isTransactionType(named)
    ? inflowType(named)
    : /\b(income|refund|credit|earned|returned|borrowed)\b/i.test(named);
  return arriving ? Math.abs(amount) : amount > 0 ? -amount : amount;
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
