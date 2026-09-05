export type SchemaFileType = "csv" | "xlsx" | "pdf" | "image" | "other";

export type FileKind =
  | "csv"
  | "xlsx"
  | "pdf"
  | "image"
  | "ofx"
  | "qif"
  | "json"
  | "html"
  | "docx"
  | "text"
  | "unknown";

import type { TransactionType } from "@/lib/money-flow/taxonomy";
import type { Verdict } from "@/lib/money-flow/verdicts";

export type { TransactionType };

/**
 * Which rung of the ladder decided a movement's type and category, so anything the reader
 * worked out can be worked out again when the rules improve, while anything the person
 * settled is left alone.
 *
 * In the order they win. `unreviewed` is not a failure to record — it is the state that
 * fills the review queue, and it is the reason Other stopped having to mean two things.
 */
export type DecidedBy = "said" | "learned" | "paired" | "merchant" | "rules" | "bank" | "ai" | "unreviewed";

export type ExtractionSource = "ai" | "ocr" | "parser";

/**
 * The statement's own words, kept exactly as they arrived and never written to.
 *
 * A bank's category is evidence, not an answer. NAB files a year of Medicare revenue under
 * "Refund" and calls 212 movements a transfer when 54 of them are. Both readings are
 * useful — they are the only thing that says which movements a bank *thought* were
 * internal — and neither can be allowed to be the figure a person is shown.
 */
export type BankWords = {
  category?: string;
  type?: string;
  merchant?: string;
};

/**
 * The bank's own row, kept exactly as it arrived. Parallel arrays so a blank
 * column (NAB's empty header between Account Number and Transaction Type) is
 * not dropped, and two columns with the same name stay apart.
 *
 * Optional so a ledger stored before this field existed still reads.
 */
export type SourceRow = {
  headers: string[];
  values: string[];
};

export type InterpretedTransaction = {
  id: string;
  merchant: string;
  /**
   * What the money was for, as a stable key like `food.groceries`. Stable because the
   * display name used to be the identity, so renaming a tag rewrote every row that
   * carried it and no report could be compared with one drawn a week earlier.
   */
  categoryKey: string;
  date: string;
  dateIso: string;
  amount: number;
  type: TransactionType;
  /** The statement's own words. Read as a signal, never shown as the answer. */
  bank?: BankWords;
  /**
   * Every cell the statement printed for this movement. Evidence, never rewritten
   * when the working columns change.
   */
  source?: SourceRow;
  decidedBy?: DecidedBy;
  sourceFile: string;
  confidence: number;
  /** The account the statement says this belongs to. Absent when the export never names one. */
  accountKey?: string;
  /** The bank the statement came from. Absent when nothing in the file names one. */
  institution?: string;
  /**
   * Which of the person's accounts this belongs to, for grouping and for matching a
   * transfer's two legs. Deliberately separate from accountKey: identity is frozen
   * when a movement is first seen, while this may improve as the reader does.
   */
  accountId?: string;
  /**
   * Set when the other leg of this transfer was found in another account, which is the
   * only thing that makes a movement the person's own money rather than income or
   * spending. Both legs carry the same value.
   */
  transferPair?: string;
  /**
   * Set when the payment this credit reverses was found in the same account. A refund is
   * not income and the payment it cancels is not spending, so both legs leave the totals
   * together — but only on the evidence of the pair, never on a bank's own wording.
   */
  refundPair?: string;
  /**
   * What the person said about money the reader could not settle from the statements
   * alone: a lender's drawdown that looks like income, a transfer from an account they
   * have not uploaded. Written on from the ledger's own record, never stored on the row.
   */
  verdict?: Verdict;
  /** Raw statement wording, kept because it identifies a movement more reliably than the tidied merchant. */
  description?: string;
  /**
   * Anything else the person wants to find this by. Freeform, as many as they like, and
   * never part of a total — a tag that moved a figure would be a second category wearing
   * a different name, which is the mistake this layer exists to undo.
   */
  tags?: string[];
  extractedBy?: ExtractionSource;
};

export type FileInterpretation = {
  filename: string;
  fileType: SchemaFileType;
  kind: FileKind;
  uploadStatus: "uploaded" | "failed";
  processingStatus: "pending" | "processing" | "completed" | "failed";
  processingError?: string;
  transactionCount: number;
  notes: string[];
};

export type CategorySpend = {
  name: string;
  amount: number;
  share: number;
};

export type MoneyFlowSummary = {
  income: number;
  spending: number;
  net: number;
  cashIn: number;
  cashOut: number;
  cashNet: number;
  /** Money moved between the person's own accounts, counted once rather than twice. */
  transfers: number;
  /** Movements a bank calls internal that have no partner here, so they still count. */
  unmatchedInternal: number;
  refunds: number;
  transactionCount: number;
  categories: CategorySpend[];
  periodLabel: string;
  insights: string[];
};

export type InterpretationResult = {
  files: FileInterpretation[];
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
};
