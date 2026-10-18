"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Dashboard", "/dashboard"],
  ["Transactions", "/transactions"],
  ["Budget", "/budgeting"],
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex w-full flex-col gap-1" aria-label="Pages">
      {links.map(([label, href]) => (
        <NavItem key={href} href={href} label={label} active={pathname === href} icon={label} />
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
}: {
  href: string;
  label: string;
  active: boolean;
  icon: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center gap-2.5 rounded-[var(--radius-card)] px-3 text-[13.5px] font-semibold ${
        active ? "bg-accent-surface text-primary" : "text-muted"
      }`}
    >
      <NavIcon name={icon} />
      {label}
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
  if (name === "Budget") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5c.6-1 3.4-1.4 4.4-.2 1 1.2-.2 2-2.2 2.4-2 .4-3.2 1.2-2.2 2.4 1 1.2 3.8.8 4.4-.2" />
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
