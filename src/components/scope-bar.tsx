"use client";

import type { ReactNode } from "react";
import type { InstitutionAccounts } from "@/lib/money-flow/accounts";
import { EVERYTHING, type LedgerScope, type ScopeView } from "@/lib/money-flow/scope";

/**
 * Banks on the first row, and the accounts inside the chosen bank on the second. Eleven
 * accounts would be eleven chips if they were all offered at once, and the question is
 * almost always which bank first.
 */
export function ScopeBar({
  groups,
  view,
  scope,
  onView,
  onScope,
}: {
  groups: InstitutionAccounts[];
  view: ScopeView;
  scope: LedgerScope;
  onView: (view: ScopeView) => void;
  onScope: (scope: LedgerScope) => void;
}) {
  const institutions = groups.map((group) => group.institution);
  // One account is not a choice, so the bar stays out of the way until there are two.
  if (institutions.length === 0) return null;
  if (institutions.length === 1 && groups[0].accounts.length < 2) return null;

  const openInstitution =
    scope.kind === "institution"
      ? scope.institution
      : scope.kind === "account"
        ? groups.find((group) => group.accounts.some((account) => account.id === scope.accountId))?.institution
        : undefined;
  const openAccounts = groups.find((group) => group.institution === openInstitution)?.accounts ?? [];
  const worthSplitting = institutions.length > 1;

  return (
    <div className="mt-5 space-y-3">
      {worthSplitting ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-1 text-xs font-bold uppercase tracking-[0.16em] text-[#527166]">Showing</p>
          <Chip active={view === "together"} onClick={() => onView("together")}>
            Together
          </Chip>
          <Chip active={view === "separate"} onClick={() => onView("separate")}>
            Separate
          </Chip>
        </div>
      ) : null}

      {view === "together" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={scope.kind === "all"} onClick={() => onScope(EVERYTHING)}>
            Everything
          </Chip>
          {institutions.map((institution) => (
            <Chip
              key={institution}
              active={openInstitution === institution}
              onClick={() => onScope({ kind: "institution", institution })}
            >
              {institution}
            </Chip>
          ))}
        </div>
      ) : null}

      {view === "together" && openInstitution && openAccounts.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-1 text-xs font-bold uppercase tracking-[0.16em] text-[#527166]">In {openInstitution}</p>
          <Chip
            active={scope.kind === "institution"}
            onClick={() => onScope({ kind: "institution", institution: openInstitution })}
            subdued
          >
            All accounts
          </Chip>
          {openAccounts.map((account) => (
            <Chip
              key={account.id}
              active={scope.kind === "account" && scope.accountId === account.id}
              onClick={() => onScope({ kind: "account", accountId: account.id })}
              subdued
            >
              {withoutInstitution(account.label, openInstitution)}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The bank is already the heading of the row, so its accounts do not repeat it. */
function withoutInstitution(label: string, institution: string): string {
  const prefix = `${institution} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

function Chip({
  active,
  onClick,
  subdued = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  subdued?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={typeof children === "string" ? children : undefined}
      onClick={onClick}
      className={`max-w-[16rem] truncate rounded-full px-3 py-1.5 font-semibold ${subdued ? "text-xs" : "text-sm"} ${
        active
          ? "bg-[#173b31] text-white"
          : `border bg-white text-[#355a3f] ${subdued ? "border-dashed border-[#c3d2ca]" : "border-[#dce4df]"}`
      }`}
    >
      {children}
    </button>
  );
}
