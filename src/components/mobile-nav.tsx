"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Home", "/dashboard"],
  ["Ledger", "/transactions"],
  ["Categories", "/categories"],
  ["Pots", "/savings"],
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-4 bottom-4 z-20 flex justify-around rounded-full border border-line bg-surface px-2 py-3 text-[11.5px] font-semibold text-muted shadow-card md:hidden">
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={pathname === href ? "text-positive" : ""}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
