import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { BrandMark } from "@/components/brand-mark";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="min-h-screen bg-[#f6f8f7] px-6 py-10 text-[#17211e]">
      <div className="mx-auto max-w-6xl">
        <BrandMark href="/" />
      </div>
      <div className="mt-16">
        <AuthForm cloudConfigured={isSupabaseConfigured()} mode="signin" callbackError={params.error === "callback"} />
      </div>
    </main>
  );
}
