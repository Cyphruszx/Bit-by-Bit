import { Geist } from "next/font/google";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { MoneyFlowProvider } from "@/components/money-flow-provider";
import { SessionProvider } from "@/components/session-provider";
import { siteDescription, siteName, siteTagline } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuthUser } from "@/lib/supabase/server";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${siteName} | ${siteTagline.replace(/\.$/, "")}`,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers();
  const user = await getAuthUser();
  return (
    <html lang="en-AU" className={geist.className}>
      <body>
        <SessionProvider cloudConfigured={isSupabaseConfigured()} initialUser={user}>
          <MoneyFlowProvider>{children}</MoneyFlowProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
