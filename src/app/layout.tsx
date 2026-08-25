import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { siteDescription, siteName, siteTagline } from "@/lib/brand";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={geist.className}>
      <body>{children}</body>
    </html>
  );
}
