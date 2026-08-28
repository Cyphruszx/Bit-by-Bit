import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { storesToImportFromLocal } from "./hydrate";
import { ALL_PERIOD } from "@/lib/money-flow/period";
import type { CloudFinance } from "./cloud";

const emptyRemote: CloudFinance = {
  files: [],
  transactions: [],
  period: ALL_PERIOD,
  recurring: { ignored: [], confirmed: [], custom: [] },
  pots: [],
  snapshots: [],
};

const emptyLocal = {
  interpreted: { files: [], transactions: [] },
  period: ALL_PERIOD,
  recurring: { ignored: [], confirmed: [], custom: [] },
  savings: null as { pots: []; snapshots: [] } | null,
};

describe("storesToImportFromLocal", () => {
  it("imports every local store when the account is empty", () => {
    const local = {
      ...emptyLocal,
      interpreted: { files: [], transactions: [{ id: "t1" }] as never },
      recurring: { ignored: ["x"], confirmed: [], custom: [] },
      savings: { pots: [{ id: "p" }], snapshots: [] } as never,
    };
    assert.deepEqual(storesToImportFromLocal(emptyRemote, local), {
      money: true,
      recurring: true,
      savings: true,
    });
  });

  it("keeps remaining local stores when money already landed in the cloud", () => {
    const remote: CloudFinance = {
      ...emptyRemote,
      transactions: [{ id: "t1" } as never],
    };
    const local = {
      ...emptyLocal,
      interpreted: { files: [], transactions: [{ id: "t2" }] as never },
      recurring: { ignored: [], confirmed: [{ id: "r1" }] as never, custom: [] },
      savings: { pots: [{ id: "p" }], snapshots: [] } as never,
    };
    assert.deepEqual(storesToImportFromLocal(remote, local), {
      money: false,
      recurring: true,
      savings: true,
    });
  });
});
