import type { ReactNode } from "react";
import { SweepBackdrop } from "@/components/sweep-backdrop";

export function AppFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`app-frame ${className}`.trim()}>
      <SweepBackdrop />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
