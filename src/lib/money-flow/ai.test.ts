import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTagSuggestions,
  createOpenAiFromEnv,
  needsInitialTag,
  parseModelJson,
  transactionsFromAiExtract,
  visionMime,
  type MoneyFlowAi,
} from "./ai";
import { interpretDocuments } from "./interpret";
import { readImageDocument } from "./parsers";
import { snapCategory } from "./categorize";
import type { InterpretedTransaction } from "./types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function txn(overrides: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: "1",
    merchant: "Mystery Shop",
    categoryKey: "uncategorised",
    date: "25 Aug",
    dateIso: "2026-08-25",
    amount: -42,
    type: "spent",
    sourceFile: "photo.jpg",
    confidence: 0.5,
    ...overrides,
  };
}

describe("AI JSON helpers", () => {
  it("parses JSON even when wrapped in markdown fences", () => {
    const parsed = parseModelJson('```json\n{"documentType":"receipt","transactions":[]}\n```');
    assert.equal((parsed as { documentType: string }).documentType, "receipt");
  });

  it("turns a receipt extract into one signed expense", () => {
    const result = transactionsFromAiExtract(
      {
        documentType: "receipt",
        notes: ["Total from the bottom of the docket."],
        transactions: [
          {
            date: "25/08/2026",
            merchant: "woolworths bondi",
            amount: 86.4,
            type: "spent",
            category: "food.groceries",
            confidence: 0.91,
          },
        ],
      },
      "receipt.jpg",
    );
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].merchant, "Woolworths Bondi");
    assert.equal(result.transactions[0].amount, -86.4);
    assert.equal(result.transactions[0].categoryKey, "groceries");
    assert.equal(result.transactions[0].decidedBy, "ai");
    assert.equal(result.transactions[0].extractedBy, "ai");
    assert.equal(result.transactions[0].dateIso, "2026-08-25");
    assert.ok(result.notes.some((note) => note.includes("receipt")));
  });

  it("drops rows without a usable amount or merchant", () => {
    const result = transactionsFromAiExtract(
      {
        transactions: [
          { date: "2026-08-25", merchant: "", amount: -10, type: "spent", category: "uncategorised" },
          { date: "2026-08-25", merchant: "Cafe", amount: 0, type: "spent", category: "food.restaurants" },
        ],
      },
      "blurry.jpg",
    );
    assert.equal(result.transactions.length, 0);
  });

  it("snaps a loose label onto a real category, and refuses to invent one", () => {
    // The detail a model gives comes back as a tag, not as a deeper category.
    assert.deepEqual(snapCategory("groceries"), { categoryKey: "groceries" });
    assert.deepEqual(snapCategory("food.groceries"), { categoryKey: "groceries", tag: "Groceries" });
    assert.deepEqual(snapCategory("Food & Drink"), { categoryKey: "eating-out", tag: "Food & Drink" });
    // Nothing recognisable is null, not a bucket: the movement stays in the review queue
    // rather than picking up a category a model invented.
    assert.equal(snapCategory("???"), null);
  });
});

describe("initial AI tagging", () => {
  it("only retags movements nothing else could settle", () => {
    const { transactions, taggedCount } = applyTagSuggestions(
      [txn(), txn({ id: "2", merchant: "Woolworths", categoryKey: "groceries", tags: ["Groceries"] })],
      [
        { id: "1", category: "shopping", confidence: 0.8 },
        { id: "2", category: "food.restaurants", confidence: 0.9 },
      ],
    );
    assert.equal(taggedCount, 1);
    assert.equal(transactions[0].categoryKey, "shopping");
    assert.equal(transactions[0].decidedBy, "ai");
    assert.equal(transactions[1].categoryKey, "groceries");
    assert.equal(needsInitialTag(transactions[1]), false);
  });

  it("ignores low-confidence suggestions and ones outside the taxonomy", () => {
    const { taggedCount, transactions } = applyTagSuggestions(
      [txn()],
      [
        { id: "1", category: "food.restaurants", confidence: 0.2 },
        { id: "missing", category: "health.gp-specialist", confidence: 0.9 },
      ],
    );
    assert.equal(taggedCount, 0);
    assert.equal(transactions[0].categoryKey, "uncategorised");
  });
});

describe("vision mime", () => {
  it("accepts common photo types and rejects HEIC", () => {
    assert.equal(visionMime("shot.JPG", ""), "image/jpeg");
    assert.equal(visionMime("shot.png", "image/png"), "image/png");
    assert.equal(visionMime("shot.heic", "image/heic"), null);
  });
});

describe("OpenAI client", () => {
  it("sends a data URL and maps the JSON reply", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  documentType: "receipt",
                  transactions: [
                    {
                      date: "2026-08-25",
                      merchant: "Soul Origin",
                      amount: -7.9,
                      type: "spent",
                      category: "food.restaurants",
                      confidence: 0.88,
                    },
                  ],
                  notes: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const ai = createOpenAiFromEnv({ OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-4o-mini" }, fetchImpl);
    assert.ok(ai);
    const result = await ai.extractFromImage({ filename: "coffee.jpg", mime: "image/jpeg", bytes: PNG });
    assert.equal(result.transactions[0].merchant, "Soul Origin");
    assert.equal(result.transactions[0].amount, -7.9);
    assert.match(calls[0].url, /chat\/completions$/);
    assert.match(calls[0].body, /data:image\/jpeg;base64,/);
  });

  it("is disabled when no API key is set", () => {
    assert.equal(createOpenAiFromEnv({}), null);
  });
});

describe("image interpretation with AI", () => {
  it("uses AI vision and skips OCR when the model finds activity", async () => {
    let ocrCalled = false;
    const ai: MoneyFlowAi = {
      extractFromImage: async () =>
        transactionsFromAiExtract(
          {
            documentType: "receipt",
            transactions: [
              {
                date: "2026-08-02",
                merchant: "Cafe Sydney",
                amount: -28.4,
                type: "spent",
                category: "food.restaurants",
                confidence: 0.9,
              },
            ],
          },
          "receipt.png",
        ),
      suggestTags: async () => [],
    };
    const parsed = await readImageDocument("receipt.png", "image/png", PNG, ai, async () => {
      ocrCalled = true;
      return "";
    });
    assert.equal(ocrCalled, false);
    assert.equal(parsed.transactions[0].categoryKey, "eating-out");
    assert.ok(parsed.notes.some((note) => /AI vision/i.test(note)));
  });

  it("falls back to OCR when AI returns nothing", async () => {
    const ai: MoneyFlowAi = {
      extractFromImage: async () => ({ transactions: [], notes: [] }),
      suggestTags: async () => [],
    };
    const parsed = await readImageDocument(
      "receipt.png",
      "image/png",
      PNG,
      ai,
      async () => "02 Aug 2026  Cafe Sydney  $28.40 DR",
    );
    assert.ok(parsed.transactions.some((row) => row.merchant.includes("Cafe")));
    assert.equal(parsed.transactions[0].extractedBy, "ocr");
    assert.ok(parsed.notes.some((note) => /on-device OCR/i.test(note)));
  });

  it("interprets a photo through interpretDocuments and tags leftovers", async () => {
    const ai: MoneyFlowAi = {
      extractFromImage: async () =>
        transactionsFromAiExtract(
          {
            documentType: "statement",
            transactions: [
              {
                date: "2026-08-25",
                merchant: "Unknown Kiosk",
                amount: -12,
                type: "spent",
                category: "uncategorised",
                confidence: 0.6,
              },
              {
                date: "2026-08-18",
                merchant: "Salary Acme",
                amount: 1500,
                type: "earned",
                categoryKey: "income",
                confidence: 0.95,
              },
            ],
          },
          "statement.png",
        ),
      suggestTags: async ({ transactions }) =>
        transactions.map((row) => ({ id: row.id, category: "shopping", confidence: 0.81 })),
    };
    const result = await interpretDocuments([{ filename: "statement.png", mime: "image/png", bytes: PNG }], { ai });
    assert.equal(result.files[0].processingStatus, "completed");
    const kiosk = result.transactions.find((row) => row.merchant === "Unknown Kiosk");
    assert.equal(kiosk?.categoryKey, "shopping");
    assert.equal(kiosk?.decidedBy, "ai");
    assert.equal(result.flow.income, 1500);
    assert.equal(result.flow.spending, 12);
    assert.ok(result.flow.insights.some((line) => /AI suggested tags/i.test(line)));
  });

  it("does not ask AI to tag when every movement already has a tag", async () => {
    let suggested = false;
    const ai: MoneyFlowAi = {
      extractFromImage: async () => ({ transactions: [], notes: [] }),
      suggestTags: async () => {
        suggested = true;
        return [];
      },
    };
    const json = JSON.stringify({
      transactions: [{ date: "2026-08-25", description: "Woolworths", amount: -86.4 }],
    });
    const result = await interpretDocuments(
      [{ filename: "export.json", mime: "application/json", bytes: new TextEncoder().encode(json) }],
      { ai },
    );
    assert.equal(suggested, false);
    assert.equal(result.transactions[0].categoryKey, "groceries");
  });

  it("asks AI to tag unknown merchants from a bank file", async () => {
    let asked = 0;
    const ai: MoneyFlowAi = {
      extractFromImage: async () => ({ transactions: [], notes: [] }),
      suggestTags: async ({ transactions }) => {
        asked = transactions.length;
        return transactions.map((row) => ({ id: row.id, category: "utilities", confidence: 0.7 }));
      },
    };
    const json = JSON.stringify({
      transactions: [{ date: "2026-08-25", description: "Acme Power Co", amount: -120 }],
    });
    const result = await interpretDocuments(
      [{ filename: "export.json", mime: "application/json", bytes: new TextEncoder().encode(json) }],
      { ai },
    );
    assert.equal(asked, 1);
    assert.equal(result.transactions[0].categoryKey, "utilities");
    assert.equal(result.transactions[0].decidedBy, "ai");
  });
});
