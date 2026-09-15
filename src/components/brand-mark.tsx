import Link from "next/link";
import { siteName } from "@/lib/brand";

export function BrandMark({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" }) {
  const labelClass = size === "sm" ? "text-lg font-bold tracking-tight" : "text-[19px] font-bold tracking-tight";

  return (
    <Link href={href} className="flex items-center gap-2.5 text-ink">
      <span aria-hidden className="grid grid-cols-2 gap-0.5">
        <span className="h-2 w-2 rounded-[2px] bg-mark-1" />
        <span className="h-2 w-2 rounded-[2px] bg-mark-2" />
        <span className="h-2 w-2 rounded-[2px] bg-mark-3" />
        <span className="h-2 w-2 rounded-[2px] bg-mark-4" />
      </span>
      <span className={labelClass}>{siteName}</span>
    </Link>
  );
}
