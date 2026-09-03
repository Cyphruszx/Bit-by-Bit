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

export type TransactionType = "income" | "expense" | "transfer" | "refund";

import type { Verdict } from "@/lib/money-flow/verdicts";

export type TagSource = "rules" | "ai" | "user";
export type ExtractionSource = "ai" | "ocr" | "parser";

export type InterpretedTransaction = {
  id: string;
  merchant: string;
  category: string;
  date: string;
  dateIso: string;
  amount: number;
  type: TransactionType;
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
  tags?: string[];
  tagSource?: TagSource;
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
