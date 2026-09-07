import { Geist } from "next/font/google";
import type { Metadata } from "next";
import { MoneyFlowProvider } from "@/components/money-flow-provider";
import { siteDescription, siteName, siteTagline } from "@/lib/brand";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
});

const homeTitle = `${siteName} | ${siteTagline.replace(/\.$/, "")}`;

/**
 * Absolute URLs for the social card. Falls back to localhost so a developer
 * previewing the page does not get a build-time warning about a relative
 * og:image; set NEXT_PUBLIC_SITE_URL on the deployment for real links.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: homeTitle,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  openGraph: {
    type: "website",
    siteName,
    title: homeTitle,
    description: siteDescription,
    locale: "en_AU",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: homeTitle,
    description: siteDescription,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={geist.className}>
      <body>
        <MoneyFlowProvider>{children}</MoneyFlowProvider>
      </body>
    </html>
  );
}
