import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canUseSupabaseAdmin, supabaseAdminConfig } from "./admin";

describe("Supabase admin (service role)", () => {
  const good = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };

  it("reads a server-only service role against the project URL", () => {
    assert.deepEqual(supabaseAdminConfig(good), {
      url: "https://abc.supabase.co",
      serviceRoleKey: "service-role-key",
    });
    assert.equal(canUseSupabaseAdmin(good), true);
  });

  it("prefers SUPABASE_URL when both are set", () => {
    assert.equal(
      supabaseAdminConfig({
        ...good,
        SUPABASE_URL: "https://internal.supabase.co",
      })?.url,
      "https://internal.supabase.co",
    );
  });

  it("ignores a NEXT_PUBLIC_ service role key", () => {
    assert.equal(
      supabaseAdminConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked",
      }),
      null,
    );
  });

  it("says no when the key or URL is missing", () => {
    assert.equal(canUseSupabaseAdmin({}), false);
    assert.equal(canUseSupabaseAdmin({ NEXT_PUBLIC_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL }), false);
    assert.equal(canUseSupabaseAdmin({ SUPABASE_SERVICE_ROLE_KEY: "service-role-key" }), false);
  });
});
