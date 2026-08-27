import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSupabaseConfigured, looksLikeServiceRoleKey } from "./config";

describe("supabase env", () => {
  it("rejects a service_role JWT so it cannot be used as the publishable key", () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    const key = `eyJhbGciOiJub25lIn0.${payload}.x`;
    assert.equal(looksLikeServiceRoleKey(key), true);
    assert.equal(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      }),
      false,
    );
    assert.equal(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-anon-key",
      }),
      true,
    );
  });
});
