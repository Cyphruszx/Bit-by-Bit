import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ProgressBar } from "@/components/progress-bar";
import { siteDescription, siteName, siteTagline } from "@/lib/brand";
import { goals, snapshot } from "@/lib/demo-data";
import { formatAud } from "@/lib/format";

const features = [
  ["One clear view", "See income, spending, and cash flow without the noise."],
  ["Goals, not just totals", "Watch savings grow toward the things you actually want."],
  ["Built for real files", "Bring bank transactions into one reliable place."],
  ["Made for Australia", "Start with an experience tailored to Australian dollars."],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#17211e]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <BrandMark />
        <Link href="/dashboard" className="rounded-full bg-[#173b31] px-5 py-2.5 text-sm font-semibold text-white">
          View dashboard
        </Link>
      </nav>
      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-16 md:grid-cols-[1.1fr_.9fr] md:items-center md:pt-24">
        <div>
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.2em] text-[#527166]">{siteTagline}</p>
          <h1 className="max-w-xl text-5xl font-bold tracking-tight md:text-6xl">Know where your money is going.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-[#52625c]">{siteDescription}</p>
          <Link
            href="/dashboard"
            className="mt-9 inline-block rounded-full bg-[#d5f06c] px-6 py-3 font-bold text-[#173b31]"
          >
            Explore the dashboard
          </Link>
        </div>
        <div className="rounded-3xl bg-[#173b31] p-7 text-white shadow-xl shadow-[#173b31]/15">
          <p className="text-sm text-[#b9cdc4]">This month</p>
          <p className="mt-3 text-4xl font-bold">{formatAud(snapshot.net)}</p>
          <p className="mt-1 text-sm text-[#b9cdc4]">Available after spending</p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs text-[#b9cdc4]">Income</p>
              <p className="mt-1 font-bold">{formatAud(snapshot.income)}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs text-[#b9cdc4]">Spent</p>
              <p className="mt-1 font-bold">{formatAud(snapshot.spending)}</p>
            </div>
          </div>
          <div className="mt-6 rounded-2xl bg-white/10 p-4">
            <p className="text-xs text-[#b9cdc4]">Emergency fund</p>
            <p className="mt-1 font-bold">
              {formatAud(goals[0].saved)} of {formatAud(goals[0].target)}
            </p>
            <ProgressBar value={(goals[0].saved / goals[0].target) * 100} />
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
        {siteName} · Placeholder demo — connected accounts and uploads come later
      </footer>
    </main>
  );
}
