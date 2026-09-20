"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-store";
import type { ColorToken } from "./tokens";

function displayColor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#")) return trimmed.toUpperCase();
  const rgb = trimmed.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return trimmed;
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export function TokenSwatch({ token }: { token: ColorToken }) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [resolved, setResolved] = useState(token.cssVar);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const read = () => {
      const styles = getComputedStyle(node);
      const fromVar = styles.getPropertyValue(token.cssVar).trim();
      setResolved(displayColor(fromVar) || fromVar || token.cssVar);
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [theme, token.cssVar]);

  return (
    <div className="grid gap-1.5">
      <div
        ref={ref}
        className={`h-[60px] rounded-[10px] ${token.swatchClass} ${token.bordered ? "border border-line" : ""}`}
      />
      <p className="text-xs font-semibold text-ink">{token.name}</p>
      <p className="font-mono text-[11px] text-muted">{token.cssVar}</p>
      <p className="font-mono text-[11px] text-muted">{resolved}</p>
    </div>
  );
}

export function FeatureFillSwatch() {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [resolved, setResolved] = useState("--highlight-gradient");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      const value = getComputedStyle(node).getPropertyValue("--highlight-gradient").trim();
      setResolved(value || "--highlight-gradient");
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [theme]);

  return (
    <div className="grid gap-1.5">
      <div
        ref={ref}
        className="h-[60px] rounded-[10px] border border-line"
        style={{ backgroundImage: "var(--highlight-gradient)" }}
      />
      <p className="text-xs font-semibold text-ink">Feature fill</p>
      <p className="font-mono text-[11px] text-muted">--highlight-gradient</p>
      <p className="font-mono text-[11px] leading-snug text-muted">{resolved}</p>
    </div>
  );
}
