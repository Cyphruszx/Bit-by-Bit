import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/signin", url.origin));
  }
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/signin?error=callback", url.origin));
    }
  }
  return NextResponse.redirect(new URL(destination, url.origin));
}
