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

function displayGradient(value: string) {
  const hexes = [...value.matchAll(/#([0-9a-f]{3,8})\b/gi)].map((match) => match[0].toUpperCase());
  if (hexes.length >= 2) return `${hexes[0]}→${hexes[1]}`;
  return displayColor(value) || value;
}

export function TokenSwatch({ token }: { token: ColorToken }) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const fallback = token.displayHex ?? token.cssVar ?? token.name;
  const [resolved, setResolved] = useState(fallback);

  useEffect(() => {
    if (token.displayHex) return;
    const node = ref.current;
    const cssVar = token.cssVar;
    if (!node || !cssVar) return;

    const read = () => {
      const raw = getComputedStyle(node).getPropertyValue(cssVar).trim();
      setResolved(token.gradient ? displayGradient(raw) : displayColor(raw) || raw || cssVar);
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [theme, token.cssVar, token.displayHex, token.gradient]);

  return (
    <div className="grid gap-1.5">
      <div
        ref={ref}
        className={`h-[60px] rounded-[10px] ${token.swatchClass} ${token.bordered ? "border border-line" : ""}`}
        style={
          token.gradient
            ? { backgroundImage: `var(${token.cssVar})` }
            : token.displayHex
              ? { backgroundColor: token.displayHex }
              : undefined
        }
      />
      <p className="text-xs font-semibold text-ink">{token.name}</p>
      <p className="font-mono text-[11px] text-muted">{resolved}</p>
      {token.note ? <p className="text-[11px] text-muted">{token.note}</p> : null}
    </div>
  );
}
