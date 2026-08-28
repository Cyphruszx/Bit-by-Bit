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
  sourceFileId?: string;
  confidence: number;
  tags?: string[];
  tagSource?: TagSource;
  extractedBy?: ExtractionSource;
};

export type FileInterpretation = {
  id?: string;
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
  transfers: number;
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
