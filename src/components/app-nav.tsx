"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

export const primaryLinks = [
  ["Dashboard", "/dashboard"],
  ["Transactions", "/transactions"],
  ["Review", "/review"],
  ["Categories", "/categories"],
  ["Budget", "/budgeting"],
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { openReviewCount } = useMoneyFlow();

  return (
    <nav className="flex w-full flex-col gap-1" aria-label="Pages">
      {primaryLinks.map(([label, href]) => (
        <NavItem
          key={href}
          href={href}
          label={label}
          active={pathname === href}
          icon={label}
          badge={href === "/review" && openReviewCount > 0 ? formatCount(openReviewCount) : undefined}
        />
      ))}
    </nav>
  );
}

export function SettingsNavItem() {
  const pathname = usePathname();
  return <NavItem href="/settings" label="Settings" active={pathname === "/settings"} icon="Settings" />;
}

function NavItem({
  href,
  label,
  active,
  icon,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-11 items-center gap-2.5 rounded-[4px] px-3 text-[13.5px] font-semibold ${
        active ? "bg-accent-surface text-primary" : "text-muted"
      }`}
    >
      <NavIcon name={icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-surface px-1 text-[11px] font-bold text-ink tabular-nums">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavIcon({ name }: { name: string }) {
  const stroke = "currentColor";
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 18,
    height: 18,
    "aria-hidden": true as const,
  };
  if (name === "Transactions") {
    return (
      <svg {...common}>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    );
  }
  if (name === "Categories") {
    return (
      <svg {...common}>
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <path d="M7 7h.01" />
      </svg>
    );
  }
  if (name === "Budget") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5c.6-1 3.4-1.4 4.4-.2 1 1.2-.2 2-2.2 2.4-2 .4-3.2 1.2-2.2 2.4 1 1.2 3.8.8 4.4-.2" />
      </svg>
    );
  }
  if (name === "Review") {
    return (
      <svg {...common}>
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    );
  }
  if (name === "Settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}
