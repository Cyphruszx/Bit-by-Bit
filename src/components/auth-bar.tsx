"use client";

import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { wipeLocalFinanceKeys } from "@/lib/persist/keys";
import { useSession } from "@/components/session-provider";

export function AuthBar() {
  const { user, hydrating } = useSession();

  if (!user) {
    return (
      <Link href="/signin" className="rounded-full border border-[#dce4df] px-4 py-2 text-sm font-semibold text-[#355a3f]">
        Sign in
      </Link>
    );
  }

  return (
    <form
      action={async () => {
        wipeLocalFinanceKeys();
        await signOut();
      }}
      className="flex items-center gap-2"
    >
      <span className="max-w-[12rem] truncate text-sm text-[#52625c]" title={user.email ?? undefined}>
        {hydrating ? "Loading account…" : user.email}
      </span>
      <button type="submit" className="rounded-full border border-[#dce4df] px-4 py-2 text-sm font-semibold text-[#355a3f]">
        Sign out
      </button>
    </form>
  );
}
