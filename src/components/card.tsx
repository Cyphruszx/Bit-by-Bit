import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Dashboard card surface. Border, shadow, radius, padding, and the header
 * gap come from the pending card tokens in globals.css so the look can
 * change in one place. The hairline and soft shadow are a placeholder.
 */
export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`ui-card-surface ui-card ${className}`.trim()}>
      {title ? (
        <header className="flex items-center justify-between gap-3 mb-[var(--card-header-gap)]">
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </article>
  );
}

/** Text action with a 44px hit area that does not change the row height. */
export function TextHit({
  href,
  children,
  onClick,
  className = "",
}: {
  href?: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const classes = `ring-hit -my-2 inline-flex min-h-11 items-center px-2 text-[14px] font-semibold text-primary ${className}`.trim();
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} onClick={onClick}>
      {children}
    </button>
  );
}
