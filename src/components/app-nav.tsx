"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

const links = [
  ["Dashboard", "/dashboard"],
  ["Transactions", "/transactions"],
  ["Categories", "/categories"],
  ["Recurring", "/recurring"],
  ["Savings", "/savings"],
  ["Accounts", "/accounts"],
  ["Review", "/review"],
] as const;

export function AppNav() {
  const pathname = usePathname();
  const { openReviewCount } = useMoneyFlow();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto font-display text-base">
      {links.map(([label, href]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`inline-flex items-center rounded-full px-[13px] py-1.5 whitespace-nowrap ${
              active ? "bg-primary text-on-primary" : "text-muted hover:bg-accent-surface"
            }`}
          >
            {label}
            {href === "/review" && openReviewCount > 0 ? (
              <span
                className={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 font-sans text-xs font-bold ${
                  active ? "bg-on-primary text-primary" : "bg-primary text-on-primary"
                }`}
              >
                {formatCount(openReviewCount)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
