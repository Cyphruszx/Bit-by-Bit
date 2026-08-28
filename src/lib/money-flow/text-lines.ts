import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { formatDisplayDate, parseAmount, parseDate } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const DATE_PATTERN =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}|\d{8})/;
const AMOUNT_PATTERN =
  /([+-]?\(?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})|\(?\$?\d+\.\d{2}\)?)\s*(CR|DR|Cr|Dr|credit|debit)?/g;

export function transactionsFromText(text: string, sourceFile: string): InterpretedTransaction[] {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const results: InterpretedTransaction[] = [];
  let rollingDate: string | null = null;

  lines.forEach((line, index) => {
    if (/\b(opening balance|closing balance|account number|bsb|page \d+)\b/i.test(line)) return;
    const dateMatch = line.match(DATE_PATTERN);
    if (dateMatch) {
      const parsed = parseDate(dateMatch[1]);
      if (parsed) rollingDate = parsed;
    }
    const amounts = [...line.matchAll(AMOUNT_PATTERN)]
      .map((match) => {
        const value = parseAmount(`${match[1]} ${match[2] ?? ""}`);
        return value == null ? null : { value, index: match.index ?? 0, raw: match[0] };
      })
      .filter((item): item is { value: number; index: number; raw: string } => item != null);

    if (amounts.length === 0) return;
    const chosen = amounts[amounts.length - 1];
    const dateIso = rollingDate ?? parseDate(line);
    if (!dateIso) return;

    let description = line.replace(dateMatch?.[0] ?? "", "").replace(chosen.raw, "").trim();
    description = description.replace(/[|•·]+/g, " ").replace(/\s+/g, " ").trim();
    if (!description || description.length < 3) return;
    if (parseAmount(description) != null && !/[A-Za-z]/.test(description)) return;

    const amount = chosen.value;
    const category = categorize(description);
    const type = inferType(description, amount, category);
    const signed =
      type === "income" || type === "refund"
        ? Math.abs(amount)
        : type === "expense" && amount > 0
          ? -amount
          : amount;

    results.push({
      id: `${sourceFile}-line-${index}-${dateIso}`,
      merchant: tidyMerchant(description),
      category,
      date: formatDisplayDate(dateIso),
      dateIso,
      amount: signed,
      type,
      sourceFile,
      confidence: 0.64,
    });
  });

  return results;
}
