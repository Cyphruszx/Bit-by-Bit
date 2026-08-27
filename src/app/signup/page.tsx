import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { BrandMark } from "@/components/brand-mark";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-[#f6f8f7] px-6 py-10 text-[#17211e]">
      <div className="mx-auto max-w-6xl">
        <BrandMark href="/" />
      </div>
      <div className="mt-16">
        <AuthForm cloudConfigured={isSupabaseConfigured()} mode="signup" />
      </div>
    </main>
  );
}
