"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

const links = [
  ["Upload", "/upload"],
  ["Dashboard", "/dashboard"],
  ["Transactions", "/transactions"],
  ["Categories", "/categories"],
  ["Recurring", "/recurring"],
  ["Savings", "/savings"],
  ["Accounts", "/accounts"],
] as const;

export function AppNav() {
  const pathname = usePathname();
  const { openReviewCount } = useMoneyFlow();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm font-semibold">
      {links.map(([label, href]) => {
        const active = pathname === href;
        const badge = href === "/transactions" ? openReviewCount : 0;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${
              active ? "bg-primary text-white" : "text-muted hover:bg-accent-surface"
            }`}
          >
            {label}
            {badge > 0 ? (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active ? "bg-white text-primary" : "bg-primary text-white"
                }`}
              >
                {formatCount(badge)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
