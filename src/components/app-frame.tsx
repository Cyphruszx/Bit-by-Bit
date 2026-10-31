import type { ReactNode } from "react";
import { SweepBackdrop } from "@/components/sweep-backdrop";

export function AppFrame({
  children,
  className = "",
  flat = false,
}: {
  children: ReactNode;
  className?: string;
  /** Flat page background. The graph-paper sweep stays on marketing pages. */
  flat?: boolean;
}) {
  return (
    <div className={`${flat ? "app-frame-flat" : "app-frame"} ${className}`.trim()}>
      {flat ? null : <SweepBackdrop />}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
