import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { SignInForm } from "@/components/sign-in-form";
import { canSignIn } from "@/lib/supabase/config";

export const metadata = { title: "Sign in · BitbyBit" };

export default function SignInPage() {
  return (
    <AppFrame>
      <main className="mx-auto w-full max-w-md px-5 py-16 md:px-7">
        <Link href="/dashboard" className="text-sm font-semibold text-ink-soft">
          ← Back to BitbyBit
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Keep your ledger</h1>
        <p className="mt-2 text-sm text-muted">
          BitbyBit works without an account, and everything stays in this browser. Signing in adds
          a backup: your statements survive a cleared browser, and follow you to another device.
        </p>

        {canSignIn() ? (
          <SignInForm />
        ) : (
          <p className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line-dashed p-6 text-sm text-muted">
            This copy of BitbyBit has no account set up, so there is nothing to sign in to. Everything
            still works — see <span className="font-semibold">supabase/README.md</span> if you want to
            add one.
          </p>
        )}
      </main>
    </AppFrame>
  );
}
