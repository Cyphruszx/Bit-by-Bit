/**
 * Fail loudly if Fiskil secrets or the token client land in browser code.
 *
 * Spec 12: FISKIL_CLIENT_ID / FISKIL_CLIENT_SECRET are server env only.
 * A NEXT_PUBLIC_ prefix, a client import of @/lib/fiskil, or a secret-shaped
 * identifier in a "use client" file would ship them in the bundle.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC = path.resolve(process.cwd(), "src");
const SECRET_SHAPED = [
  /FISKIL_CLIENT_SECRET/,
  /FISKIL_CLIENT_ID/,
  /FISKIL_WEBHOOK_SECRET/,
  /NEXT_PUBLIC_FISKIL/,
  /client_secret/,
  /clientSecret/,
  /webhookSecret/,
  /getFiskilAppToken/,
  /FiskilAppToken/,
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

function isClientModule(source: string): boolean {
  const head = source.split(/\r?\n/, 8).join("\n");
  return /^["']use client["'];?$/m.test(head);
}

describe("Fiskil secrets never reach the client bundle", () => {
  const files = walk(SRC);

  it("never reads NEXT_PUBLIC_ Fiskil keys from process.env", () => {
    const leaks = files.flatMap((file) => {
      if (file.endsWith(".test.ts")) return [];
      const source = readFileSync(file, "utf8");
      return /process\.env\.NEXT_PUBLIC_FISKIL/.test(source) ? [path.relative(SRC, file)] : [];
    });
    assert.deepEqual(leaks, []);
  });

  it("keeps Fiskil secret-shaped identifiers out of client modules", () => {
    const leaks: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) continue;
      for (const pattern of SECRET_SHAPED) {
        if (pattern.test(source)) leaks.push(`${path.relative(SRC, file)}: ${pattern}`);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it("does not let client modules import the Fiskil server library", () => {
    const leaks = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) return [];
      return /from\s+["']@\/lib\/fiskil(?:\/[^"']*)?["']/.test(source) ? [path.relative(SRC, file)] : [];
    });
    assert.deepEqual(leaks, []);
  });

  it("documents Fiskil env as server-only in .env.example", () => {
    const example = readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
    assert.match(example, /FISKIL_CLIENT_ID=/);
    assert.match(example, /FISKIL_CLIENT_SECRET=/);
    assert.match(example, /FISKIL_WEBHOOK_SECRET=/);
    assert.doesNotMatch(example, /NEXT_PUBLIC_FISKIL/);
    assert.match(example, /Never prefix this with NEXT_PUBLIC_/);
  });
});
