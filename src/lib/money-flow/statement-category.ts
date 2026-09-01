/**
 * Maps a bank export's own category label onto BitbyBit tags.
 * Used only when merchant rules cannot label the movement.
 */
const BANK_TAGS: Array<[RegExp, string]> = [
  [/\bgrocer/i, "Groceries"],
  [/\bfuel|petrol/i, "Transport"],
  [/\brestaurant|takeaway|dining|eating out|coffee/i, "Dining"],
  [/\bmedical|health|pharmacy/i, "Health"],
  [/\bgovernment|centrelink|benefit/i, "Income"],
  [/\bother income|salary|wage|payroll/i, "Income"],
  [/\btransfer/i, "Goals"],
  [/\bshopping|retail/i, "Shopping"],
  [/\bentertainment/i, "Entertainment"],
  [/\butility|utilities|bills/i, "Utilities"],
  [/\bsubscription/i, "Subscriptions"],
  [/\btravel|holiday/i, "Travel"],
  [/\bhousing|rent|mortgage/i, "Housing"],
];

export function tagFromBankCategory(raw: string, amount: number): string {
  const label = raw.trim();
  if (!label || /^(uncategoris[ed]+|uncategoriz[ed]+|other|general)$/i.test(label)) return "Other";
  if (/^interest$/i.test(label)) return amount > 0 ? "Income" : "Other";
  for (const [pattern, tag] of BANK_TAGS) {
    if (pattern.test(label)) return tag;
  }
  return "Other";
}

export function tableInterpretationNotes(headers: string[]): string[] {
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const has = (name: string) => normalized.some((header) => header === name || header.includes(name));
  if (has("merchant name") && has("transaction type") && has("category")) {
    return ["Read as a NAB account export. Amounts, merchants, and categories come from the statement columns."];
  }
  if (has("category")) {
    return ["Used the statement's category column when a merchant was unlabelled."];
  }
  return [];
}
