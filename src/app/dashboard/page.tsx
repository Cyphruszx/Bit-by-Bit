import Link from "next/link";

const transactions = [
  ["Woolworths", "Groceries", "Today", "-$86.40"],
  ["Netflix", "Subscriptions", "Yesterday", "-$18.99"],
  ["Salary", "Income", "18 Aug", "+$2,620.00"],
  ["Opal", "Transport", "17 Aug", "-$42.00"],
];

const categories = [["Groceries", "$624", "42%"], ["Housing", "$980", "66%"], ["Dining", "$216", "29%"], ["Transport", "$157", "21%"]];

function SummaryCard({ label, value, detail, positive = false }: { label: string; value: string; detail: string; positive?: boolean }) {
  return <article className="rounded-2xl border border-[#dce4df] bg-white p-5"><p className="text-sm text-[#60716a]">{label}</p><p className={`mt-2 text-2xl font-bold ${positive ? "text-[#257155]" : ""}`}>{value}</p><p className="mt-1 text-sm text-[#77857f]">{detail}</p></article>;
}

export default function Dashboard() {
  return <main className="min-h-screen bg-[#f6f8f7] text-[#17211e]"><header className="border-b border-[#dce4df] bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"><Link href="/" className="text-xl font-bold">ClearLedger</Link><span className="rounded-full bg-[#edf4dc] px-3 py-1 text-sm font-medium text-[#355a3f]">Demo dashboard</span></div></header><div className="mx-auto max-w-6xl px-6 py-10"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">August 2026</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1><p className="mt-2 text-[#60716a]">Placeholder data only — connected accounts and uploads come in later checkpoints.</p><section className="mt-8 grid gap-4 sm:grid-cols-3"><SummaryCard label="Total income" value="$5,240.00" detail="This month" positive /><SummaryCard label="Total spending" value="$3,397.40" detail="This month" /><SummaryCard label="Net cash flow" value="$1,842.60" detail="Income minus spending" positive /></section><section className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]"><article className="rounded-2xl border border-[#dce4df] bg-white p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Recent transactions</h2><span className="text-sm text-[#60716a]">Placeholder</span></div><div className="mt-5 divide-y divide-[#edf0ee]">{transactions.map(([merchant, category, date, amount]) => <div className="flex items-center justify-between py-4" key={merchant}><div><p className="font-semibold">{merchant}</p><p className="mt-1 text-sm text-[#77857f]">{category} · {date}</p></div><p className={`font-semibold ${amount.startsWith("+") ? "text-[#257155]" : ""}`}>{amount}</p></div>)}</div></article><article className="rounded-2xl border border-[#dce4df] bg-white p-6"><h2 className="text-lg font-bold">Spending categories</h2><div className="mt-5 space-y-5">{categories.map(([name, amount, percentage]) => <div key={name}><div className="flex justify-between text-sm"><span className="font-medium">{name}</span><span className="text-[#60716a]">{amount}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#edf0ee]"><div className="h-full rounded-full bg-[#73a883]" style={{ width: percentage }} /></div></div>)}</div></article></section></div></main>;
}
