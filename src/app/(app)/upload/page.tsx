import type { Metadata } from "next";
import { UploadStudio } from "@/components/upload-studio";

export const metadata: Metadata = {
  title: "Upload",
};

export default function UploadPage() {
  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Interpret money flow</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Upload documents</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        This is the core of BitbyBit. Drop bank files, invoices, receipts, and statements in almost any common format.
        The app reads them and turns the activity into money in, money out, and tags.
      </p>
      <div className="mt-8">
        <UploadStudio />
      </div>
    </>
  );
}
