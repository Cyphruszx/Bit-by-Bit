"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Dashboard", "/dashboard"],
  ["Transactions", "/transactions"],
  ["Goals", "/goals"],
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
              active ? "bg-[#173b31] text-white" : "text-[#52625c] hover:bg-[#edf4dc]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
