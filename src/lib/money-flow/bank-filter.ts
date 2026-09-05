import { interpretMovement, type RawMovement } from "@/lib/money-flow/interpret-row";
import { looksLikeNabExport, movementsFromNabTable } from "@/lib/money-flow/nab-statement";
import { tableInterpretationNotes } from "@/lib/money-flow/statement-category";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import { looksLikeUpStatement, movementsFromUpStatement } from "@/lib/money-flow/up-statement";

export type BankFilterInput = {
  sourceFile: string;
  headers?: string[];
  rows?: Array<Array<string | number | null>>;
  text?: string;
};

/**
 * Stage A: the bank that owns this file maps it onto source cells and a raw
 * movement. Stage B (`interpretMovement`) then fills the working columns.
 */
export function readBankSource(
  input: BankFilterInput,
): { transactions: InterpretedTransaction[]; notes: string[] } | null {
  if (input.headers && looksLikeNabExport(input.headers)) {
    return interpreted(movementsFromNabTable(input.headers, input.rows ?? [], input.sourceFile), tableInterpretationNotes(input.headers));
  }
  if (input.text && looksLikeUpStatement(input.text)) {
    return interpreted(movementsFromUpStatement(input.text, input.sourceFile), [
      "Read as an Up / Bendigo bank statement.",
    ]);
  }
  return null;
}

function interpreted(
  movements: RawMovement[],
  notes: string[],
): { transactions: InterpretedTransaction[]; notes: string[] } {
  return { transactions: movements.map(interpretMovement), notes };
}
