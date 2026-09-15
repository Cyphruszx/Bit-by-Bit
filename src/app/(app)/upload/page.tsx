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
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-muted">Interpret money flow</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Upload documents</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Core ingest is CSV and OCR only. Drop one bank CSV or photograph a page. Preview the mapped rows, then Confirm —
        a CSV slot is used only then. Excel, OFX, and QIF are unavailable.
      </p>
      <div className="mt-8">
        <UploadStudio aiReady={aiReady} />
      </div>
    </>
  );
}
