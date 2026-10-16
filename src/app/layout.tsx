import { Geist_Pixel, Public_Sans } from "next/font/google";
import type { Metadata } from "next";
import { MoneyFlowProvider } from "@/components/money-flow-provider";
import { FontScript, ThemeScript } from "@/components/theme-script";
import { siteDescription, siteName, siteTagline } from "@/lib/brand";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans",
});

const geistPixel = Geist_Pixel({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-pixel",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: {
    default: `${siteName} | ${siteTagline.replace(/\.$/, "")}`,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-AU"
      className={`${publicSans.variable} ${geistPixel.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
        <FontScript />
      </head>
      <body>
        <MoneyFlowProvider>{children}</MoneyFlowProvider>
      </body>
    </html>
  );
}
