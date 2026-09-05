"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * The four things the backup needs from a database, and nothing about which database.
 *
 * Everything interesting about syncing — what merges with what, whose ledger this is, which
 * revision a write is answering — lives in cloud-ledger-store.ts and is worth reading on its
 * own. Keeping the query chaining out of there is what lets those rules be tested without a
 * project to connect to.
 *
 * read: the row, "absent" when the account reachably has none, null when we could not ask.
 * insert/update: the new revision, or null when the write touched nothing.
 */
export type CloudRows = {
  read(userId: string): Promise<{ document: unknown; revision: number } | "absent" | null>;
  insert(userId: string, document: unknown): Promise<number | null>;
  update(userId: string, document: unknown, revision: number): Promise<number | null>;
  remove(userId: string): Promise<void>;
};

const TABLE = "ledgers";

/** Who is signed in, if this copy has an account to sign in to at all. */
export async function signedInUserId(): Promise<string | null> {
  const client = supabase();
  if (!client) return null;
  try {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export function supabaseRows(): CloudRows {
  return {
    async read(userId) {
      const client = supabase();
      if (!client) return null;
      try {
        const { data, error } = await client
          .from(TABLE)
          .select("document, revision")
          .eq("user_id", userId)
          .maybeSingle<{ document: unknown; revision: number }>();
        if (error) return null;
        return data ?? "absent";
      } catch {
        return null;
      }
    },

    async insert(userId, document) {
      const client = supabase();
      if (!client) return null;
      try {
        const { data } = await client
          .from(TABLE)
          .insert({ user_id: userId, document })
          .select("revision")
          .maybeSingle<{ revision: number }>();
        return data?.revision ?? null;
      } catch {
        return null;
      }
    },

    async update(userId, document, revision) {
      const client = supabase();
      if (!client) return null;
      try {
        // Naming the revision we are answering is the whole concurrency check: if another
        // device has written since, this matches no row and comes back empty.
        const { data } = await client
          .from(TABLE)
          .update({ document })
          .eq("user_id", userId)
          .eq("revision", revision)
          .select("revision")
          .maybeSingle<{ revision: number }>();
        return data?.revision ?? null;
      } catch {
        return null;
      }
    },

    async remove(userId) {
      const client = supabase();
      if (!client) return;
      try {
        await client.from(TABLE).delete().eq("user_id", userId);
      } catch {
        // Clearing locally is what the person asked for and has already happened.
      }
    },
  };
}
