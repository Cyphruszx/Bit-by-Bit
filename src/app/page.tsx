import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { siteDescription, siteName } from "@/lib/brand";

const features = [
  ["Almost any document", "CSV, Excel, PDF, OFX, QIF, Word, HTML, JSON, photos of receipts, and plain text."],
  ["AI reads photos", "Vision extracts totals from receipts and statement photos, then suggests tags when the merchant is unclear."],
  ["Interpreted money flow", "See money in, money out, and the tags that actually moved."],
  ["Made for Australia", "Dates, dollars, and merchants parsed with local statements in mind."],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#17211e]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <BrandMark />
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm font-semibold text-[#355a3f]">
            Dashboard
          </Link>
          <Link href="/upload" className="rounded-full bg-[#173b31] px-5 py-2.5 text-sm font-semibold text-white">
            Upload a document
          </Link>
        </div>
      </nav>
      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-16 md:grid-cols-[1.1fr_.9fr] md:items-center md:pt-24">
        <div>
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.2em] text-[#527166]">Core feature</p>
          <h1 className="max-w-xl text-5xl font-bold tracking-tight md:text-6xl">Upload documents. See the money flow.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-[#52625c]">{siteDescription}</p>
          <Link
            href="/upload"
            className="mt-9 inline-block rounded-full bg-[#d5f06c] px-6 py-3 font-bold text-[#173b31]"
          >
            Interpret a statement
          </Link>
        </div>
        <div className="rounded-3xl bg-[#173b31] p-7 text-white shadow-xl shadow-[#173b31]/15">
          <p className="text-sm text-[#b9cdc4]">What BitbyBit reads</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-[#d5e4dd]">
            <li>Bank CSV and Excel exports</li>
            <li>OFX, QFX, and QIF downloads</li>
            <li>PDF statements and Word docs</li>
            <li>Photos of receipts and printed pages, read with AI when configured</li>
          </ul>
          <p className="mt-8 text-sm text-[#b9cdc4]">Then it shows</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs text-[#b9cdc4]">Money in</p>
              <p className="mt-1 font-bold">Income and refunds</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs text-[#b9cdc4]">Money out</p>
              <p className="mt-1 font-bold">Spending by tag</p>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-2 lg:grid-cols-4">
        {features.map(([title, description]) => (
          <article key={title} className="rounded-2xl border border-[#dce4df] bg-white p-6">
            <h2 className="font-bold">{title}</h2>
            <p className="mt-2 leading-6 text-[#52625c]">{description}</p>
          </article>
        ))}
      </section>
      <footer className="border-t border-[#dce4df] px-6 py-8 text-center text-sm text-[#60716a]">
        {siteName} · Upload a document to replace the demo snapshot
      </footer>
    </main>
  );
}
