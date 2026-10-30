"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryLinks } from "@/components/app-nav";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

export function MobileNav() {
  const pathname = usePathname();
  const { openReviewCount } = useMoneyFlow();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-line bg-surface md:hidden"
      aria-label="Pages"
    >
      <div className="flex">
        {primaryLinks.map(([label, href]) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 min-w-11 flex-1 items-center justify-center px-1 text-center text-[11px] font-semibold leading-tight ${
                active ? "bg-accent-surface text-primary" : "text-muted"
              }`}
            >
              <span>
                {label}
                {href === "/review" && openReviewCount > 0 ? (
                  <span className="ml-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-surface px-1 font-sans text-[11px] font-bold text-ink tabular-nums">
                    {formatCount(openReviewCount)}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
