import type { Metadata } from "next";
import { connection } from "next/server";
import { UploadStudio } from "@/components/upload-studio";
import { isAiConfigured } from "@/lib/money-flow/ai";

export const metadata: Metadata = {
  title: "Upload",
};

export const maxDuration = 60;

export default async function UploadPage() {
  await connection();
  const aiReady = isAiConfigured();
  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Interpret money flow</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Upload documents</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        This is the core of BitbyBit. Drop bank files, invoices, receipts, and statements in almost any common format.
        The app reads them, pulls activity from photos, and suggests tags when the built-in merchant rules cannot.
      </p>
      <div className="mt-8">
        <UploadStudio aiReady={aiReady} />
      </div>
    </>
  );
}
