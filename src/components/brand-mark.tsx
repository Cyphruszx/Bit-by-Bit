import Link from "next/link";
import { siteName } from "@/lib/brand";

export function BrandMark({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" }) {
  const labelClass = size === "sm" ? "text-lg font-bold tracking-tight" : "text-xl font-bold tracking-tight";

  return (
    <Link href={href} className="flex items-center gap-2.5 text-[#17211e]">
      <span aria-hidden className="grid grid-cols-2 gap-0.5">
        <span className="h-2 w-2 rounded-[2px] bg-[#173b31]" />
        <span className="h-2 w-2 rounded-[2px] bg-[#d5f06c]" />
        <span className="h-2 w-2 rounded-[2px] bg-[#73a883]" />
        <span className="h-2 w-2 rounded-[2px] bg-[#173b31]" />
      </span>
      <span className={labelClass}>{siteName}</span>
    </Link>
  );
}
