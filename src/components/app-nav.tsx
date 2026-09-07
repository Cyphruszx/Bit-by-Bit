"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm font-semibold">
      {links.map(([label, href]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${
              active ? "bg-primary text-on-primary hover:bg-primary-hover" : "text-muted hover:bg-accent-surface"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
