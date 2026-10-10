import { Public_Sans, Silkscreen } from "next/font/google";
import type { Metadata } from "next";
import { MoneyFlowProvider } from "@/components/money-flow-provider";
import { ThemeScript } from "@/components/theme-script";
import { siteDescription, siteName, siteTagline } from "@/lib/brand";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const silkscreen = Silkscreen({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
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
      className={`${publicSans.className} ${publicSans.variable} ${silkscreen.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <MoneyFlowProvider>{children}</MoneyFlowProvider>
      </body>
    </html>
  );
}
