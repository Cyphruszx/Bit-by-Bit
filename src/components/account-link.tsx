"use client";

import Link from "next/link";
import { useSession } from "@/components/session-store";
import { accountChromeCopy } from "@/lib/auth/account-chrome";
import { canSignIn } from "@/lib/supabase/config";

/**
 * The header's account control, paired with Upload/Add.
 * Absent entirely when this copy has nowhere to sign in to,
 * so an app with no backup configured looks exactly as it always did.
 */
export function AccountLink() {
  const session = useSession();
  if (!canSignIn()) return null;

  const chrome = accountChromeCopy(session);

  return (
    <Link
      href="/sign-in"
      title={chrome.title}
      className={`rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-ink-soft ${
        chrome.signedIn ? "font-semibold" : "font-bold"
      }`}
    >
      {chrome.signedIn ? (
        <>
          <span className="hidden max-w-[12rem] truncate sm:inline">{chrome.label}</span>
          <span className="sm:hidden">{chrome.compactLabel}</span>
        </>
      ) : (
        chrome.label
      )}
    </Link>
  );
}
