import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import { replaceMoneyFlow, inList } from "./cloud";

type Call = {
  table: string;
  op: string;
  payload?: unknown;
  onConflict?: string;
  not?: string;
};

class FakeQuery {
  private op = "select";
  private payload: unknown;
  private onConflict?: string;
  private notValue?: string;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }

  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.onConflict = opts?.onConflict;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq() {
    return this;
  }

  order() {
    return this;
  }

  not(_column: string, _op: string, value: string) {
    this.notValue = value;
    return this;
  }

  maybeSingle() {
    return this;
  }

  then<TResult>(
    resolve: (value: { data: unknown; error: null }) => TResult,
    reject?: (reason: unknown) => TResult,
  ) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  private run() {
    if (this.db.failUpsert && this.op === "upsert") {
      throw new Error("upsert failed");
    }
    this.db.calls.push({
      table: this.table,
      op: this.op,
      payload: this.payload,
      onConflict: this.onConflict,
      not: this.notValue,
    });
    return { data: this.db.tables[this.table] ?? [], error: null };
  }
}

class FakeDb {
  calls: Call[] = [];
  failUpsert = false;
  tables: Record<string, unknown[]> = {
    categories: [{ id: "cat-groceries", name: "Groceries", user_id: "user-1" }],
  };

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const fileA: FileInterpretation = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  filename: "statement.csv",
  fileType: "csv",
  kind: "csv",
  uploadStatus: "uploaded",
  processingStatus: "completed",
  transactionCount: 1,
  notes: [],
};

const fileB: FileInterpretation = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  filename: "statement.csv",
  fileType: "csv",
  kind: "csv",
  uploadStatus: "uploaded",
  processingStatus: "completed",
  transactionCount: 1,
  notes: [],
};

function txn(patch: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "sourceFile">): InterpretedTransaction {
  return {
    merchant: "Woolworths",
    category: "Groceries",
    tags: ["Groceries"],
    date: "25 Aug",
    dateIso: "2026-08-25",
    amount: -10,
    type: "expense",
    confidence: 1,
    ...patch,
  };
}

describe("replaceMoneyFlow", () => {
  it("upserts before deleting extras so a failed write cannot wipe the account", async () => {
    const db = new FakeDb();
    await replaceMoneyFlow(db as never, "user-1", [fileA], [txn({ id: "csv-1", sourceFile: "statement.csv", sourceFileId: fileA.id })]);
    const ops = db.calls.map((call) => `${call.table}:${call.op}`);
    assert.ok(ops.indexOf("uploaded_files:upsert") < ops.indexOf("uploaded_files:delete"));
    assert.ok(ops.indexOf("transactions:upsert") < ops.indexOf("transactions:delete"));
    assert.equal(db.calls.find((call) => call.table === "uploaded_files" && call.op === "upsert")?.onConflict, "id");
    assert.equal(db.calls.find((call) => call.table === "transactions" && call.op === "upsert")?.onConflict, "user_id,client_key");
  });

  it("does not delete existing rows when upsert fails", async () => {
    const db = new FakeDb();
    db.failUpsert = true;
    await assert.rejects(() => replaceMoneyFlow(db as never, "user-1", [fileA], [txn({ id: "csv-1", sourceFile: "statement.csv" })]));
    assert.equal(
      db.calls.some((call) => call.op === "delete"),
      false,
    );
  });

  it("links movements by file id when two documents share a filename", async () => {
    const db = new FakeDb();
    await replaceMoneyFlow(
      db as never,
      "user-1",
      [fileA, fileB],
      [
        txn({ id: "row-a", sourceFile: "statement.csv", sourceFileId: fileA.id }),
        txn({ id: "row-b", sourceFile: "statement.csv", sourceFileId: fileB.id }),
      ],
    );
    const upsert = db.calls.find((call) => call.table === "transactions" && call.op === "upsert");
    const rows = upsert?.payload as Array<{ client_key: string; source_file_id: string | null }>;
    assert.equal(rows.find((row) => row.client_key === "row-a")?.source_file_id, fileA.id);
    assert.equal(rows.find((row) => row.client_key === "row-b")?.source_file_id, fileB.id);
  });

  it("skips zero-amount rows that the schema cannot store", async () => {
    const db = new FakeDb();
    await replaceMoneyFlow(db as never, "user-1", [fileA], [
      txn({ id: "keep", sourceFile: "statement.csv", sourceFileId: fileA.id }),
      txn({ id: "zero", sourceFile: "statement.csv", sourceFileId: fileA.id, amount: 0 }),
    ]);
    const upsert = db.calls.find((call) => call.table === "transactions" && call.op === "upsert");
    const rows = upsert?.payload as Array<{ client_key: string }>;
    assert.deepEqual(rows.map((row) => row.client_key), ["keep"]);
  });
});

describe("inList", () => {
  it("quotes values for PostgREST in-filters", () => {
    assert.equal(inList(["csv-1", "csv-2"]), '("csv-1","csv-2")');
  });
});
