"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

const links = [
  ["Home", "/dashboard"],
  ["Ledger", "/transactions"],
  ["Review", "/review"],
  ["Categories", "/categories"],
  ["Pots", "/savings"],
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const { openReviewCount } = useMoneyFlow();

  return (
    <nav className="fixed inset-x-4 bottom-4 z-20 flex justify-around rounded-full border border-line bg-surface px-2 py-3 text-[11.5px] font-semibold text-muted shadow-card md:hidden">
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={`inline-flex items-center gap-1 ${pathname === href ? "text-positive" : ""}`}
        >
          {label}
          {href === "/review" && openReviewCount > 0 ? (
            <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-primary">
              {formatCount(openReviewCount)}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
