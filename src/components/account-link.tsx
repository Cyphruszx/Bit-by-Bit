"use client";

import Link from "next/link";
import { useSession } from "@/components/session-store";
import { canSignIn } from "@/lib/supabase/config";

/**
 * The header's account control. Absent entirely when this copy has nowhere to sign in to,
 * so an app with no backup configured looks exactly as it always did.
 */
export function AccountLink() {
  const session = useSession();
  if (!canSignIn()) return null;

  return (
    <Link
      href="/sign-in"
      title={session ? `Signed in as ${session.email}` : "Sign in to back up your ledger"}
      className="rounded-full border border-[#dce4df] px-3 py-1.5 text-sm font-semibold text-[#355a3f]"
    >
      {session ? "Backed up" : "Sign in"}
    </Link>
  );
}
