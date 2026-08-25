import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClearLedger | Personal finance, clearly",
  description: "A simple, secure view of your money.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
