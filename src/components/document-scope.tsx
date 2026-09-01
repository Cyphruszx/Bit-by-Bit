"use client";

import type { ReactNode } from "react";
import { documentLabel, type DocumentScope, type DocumentView } from "@/lib/money-flow/documents";

export function DocumentScopeBar({
  sourceFiles,
  view,
  scope,
  onView,
  onScope,
}: {
  sourceFiles: string[];
  view: DocumentView;
  scope: DocumentScope;
  onView: (view: DocumentView) => void;
  onScope: (scope: DocumentScope) => void;
}) {
  if (sourceFiles.length < 2) return null;

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-1 text-xs font-bold uppercase tracking-[0.16em] text-[#527166]">Documents</p>
        <Chip active={view === "together"} onClick={() => onView("together")}>
          Together
        </Chip>
        <Chip active={view === "separate"} onClick={() => onView("separate")}>
          Separate
        </Chip>
      </div>
      {view === "together" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={scope.kind === "all"} onClick={() => onScope({ kind: "all" })}>
            All documents
          </Chip>
          {sourceFiles.map((sourceFile) => (
            <Chip
              key={sourceFile}
              active={scope.kind === "file" && scope.sourceFile === sourceFile}
              onClick={() => onScope({ kind: "file", sourceFile })}
            >
              {documentLabel(sourceFile)}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={typeof children === "string" ? children : undefined}
      onClick={onClick}
      className={`max-w-[16rem] truncate rounded-full px-3 py-1.5 text-sm font-semibold ${
        active ? "bg-[#173b31] text-white" : "border border-[#dce4df] bg-white text-[#355a3f]"
      }`}
    >
      {children}
    </button>
  );
}
