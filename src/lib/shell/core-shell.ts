/**
 * Spec 5 Core shell. Day-one chrome is Upload / Dashboard / Transactions /
 * Accounts plus Spec 10 money tiles. Goals and Linked balances stay off until
 * the first CLEARED row, then an enable offer. Cash Flow, Recurring, and
 * Budget (Spec 11 unlocked) stay out of nav and the offer.
 *
 * Layout JSON + theme persist here so Spec 4 can copy the blob later.
 * This module does not migrate guest → account.
 */

export const SPEC_11_LOCKED = false;

export const CORE_NAV = [
  { label: "Upload", href: "/upload" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Transactions", href: "/transactions" },
  { label: "Accounts", href: "/accounts" },
] as const;

export const OMIT_FROM_NAV_AND_OFFER = ["recurring", "cash-flow", "cash_flow", "budget"] as const;

export type WidgetId = "money-tiles" | "goals" | "linked-balances";
export type FeatureId = "goals" | "linked-balances";
export type ThemeId = "default";

export type LayoutEntry = {
  id: WidgetId;
  archived?: boolean;
};

export type Goal = {
  id: string;
  name: string;
  allocated: number;
};

export type ShellState = {
  version: 1;
  theme: ThemeId;
  widgets: LayoutEntry[];
  enabled: { goals: boolean; linkedBalances: boolean };
  offerDismissed: boolean;
  goals: Goal[];
  linkedAccountIds: string[];
};

export const DEFAULT_SHELL: ShellState = {
  version: 1,
  theme: "default",
  widgets: [{ id: "money-tiles" }],
  enabled: { goals: false, linkedBalances: false },
  offerDismissed: false,
  goals: [],
  linkedAccountIds: [],
};

const WIDGET_IDS: WidgetId[] = ["money-tiles", "goals", "linked-balances"];

export function parseShell(raw: unknown): ShellState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SHELL, widgets: [{ id: "money-tiles" }] };
  const value = raw as Partial<ShellState>;
  const enabled = {
    goals: value.enabled?.goals === true,
    linkedBalances: value.enabled?.linkedBalances === true,
  };
  const widgets = Array.isArray(value.widgets)
    ? value.widgets.flatMap((entry): LayoutEntry[] => {
        if (!entry || typeof entry !== "object") return [];
        const id = (entry as LayoutEntry).id;
        if (!WIDGET_IDS.includes(id)) return [];
        return [{ id, archived: (entry as LayoutEntry).archived === true }];
      })
    : [];
  const goals = Array.isArray(value.goals)
    ? value.goals.flatMap((goal): Goal[] => {
        if (!goal || typeof goal !== "object") return [];
        const id = typeof goal.id === "string" ? goal.id : "";
        const name = typeof goal.name === "string" ? goal.name : "";
        const allocated = typeof goal.allocated === "number" && Number.isFinite(goal.allocated) ? goal.allocated : 0;
        return id ? [{ id, name, allocated }] : [];
      })
    : [];
  const linkedAccountIds = Array.isArray(value.linkedAccountIds)
    ? value.linkedAccountIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return normalize({
    version: 1,
    theme: "default",
    widgets,
    enabled,
    offerDismissed: value.offerDismissed === true,
    goals,
    linkedAccountIds,
  });
}

export function normalize(state: ShellState): ShellState {
  const seen = new Set<WidgetId>();
  const widgets: LayoutEntry[] = [];
  for (const entry of state.widgets) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const required = entry.id === "goals" ? state.enabled.goals : entry.id === "linked-balances" ? state.enabled.linkedBalances : true;
    widgets.push({
      id: entry.id,
      archived: entry.id === "money-tiles" ? false : !required,
    });
  }
  if (!seen.has("money-tiles")) widgets.unshift({ id: "money-tiles" });
  if (state.enabled.goals && !seen.has("goals")) widgets.push({ id: "goals" });
  if (state.enabled.linkedBalances && !seen.has("linked-balances")) widgets.push({ id: "linked-balances" });
  return { ...state, version: 1, theme: "default", widgets };
}

export function navLinks(state: ShellState): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = CORE_NAV.map((link) => ({ ...link }));
  if (state.enabled.goals) links.push({ label: "Goals", href: "/goals" });
  if (state.enabled.linkedBalances) links.push({ label: "Linked balances", href: "/linked-balances" });
  return links;
}

export function navLabels(state: ShellState): string[] {
  return navLinks(state).map((link) => link.label);
}

export function hasFirstCleared(transactions: { status?: string }[]): boolean {
  return transactions.some((txn) => (txn.status ?? "CLEARED") === "CLEARED");
}

export type OfferItem = { id: FeatureId; label: string };

export function enableOffer(state: ShellState, firstCleared: boolean, spec11Locked = SPEC_11_LOCKED): OfferItem[] {
  if (!firstCleared || state.offerDismissed) return [];
  const items: OfferItem[] = [];
  if (!state.enabled.goals) items.push({ id: "goals", label: "Goals" });
  if (!state.enabled.linkedBalances) items.push({ id: "linked-balances", label: "Linked balances" });
  // ponytail: Spec 11 is not locked, so Budget never joins the offer.
  void spec11Locked;
  return items;
}

export function offerLabels(state: ShellState, firstCleared: boolean, spec11Locked = SPEC_11_LOCKED): string[] {
  return enableOffer(state, firstCleared, spec11Locked).map((item) => item.label);
}

export function setFeature(state: ShellState, feature: FeatureId, on: boolean): ShellState {
  const enabled = {
    ...state.enabled,
    [feature === "goals" ? "goals" : "linkedBalances"]: on,
  };
  const widgetId: WidgetId = feature;
  const widgets = state.widgets.map((entry) => ({ ...entry }));
  const index = widgets.findIndex((entry) => entry.id === widgetId);
  if (on) {
    if (index >= 0) widgets[index] = { ...widgets[index], archived: false };
    else widgets.push({ id: widgetId });
  } else if (index >= 0) {
    widgets[index] = { ...widgets[index], archived: true };
  }
  return normalize({ ...state, enabled, widgets });
}

export function visibleWidgets(state: ShellState): WidgetId[] {
  return state.widgets
    .filter((entry) => {
      if (entry.archived) return false;
      if (entry.id === "goals") return state.enabled.goals;
      if (entry.id === "linked-balances") return state.enabled.linkedBalances;
      return true;
    })
    .map((entry) => entry.id);
}

export function dismissOffer(state: ShellState): ShellState {
  return { ...state, offerDismissed: true };
}

export function setTheme(state: ShellState, theme: ThemeId): ShellState {
  return { ...state, theme };
}

export function upsertGoal(state: ShellState, goal: Goal): ShellState {
  const goals = state.goals.some((item) => item.id === goal.id)
    ? state.goals.map((item) => (item.id === goal.id ? goal : item))
    : [...state.goals, goal];
  return { ...state, goals };
}

export function removeGoal(state: ShellState, id: string): ShellState {
  return { ...state, goals: state.goals.filter((goal) => goal.id !== id) };
}

export function setLinkedAccounts(state: ShellState, linkedAccountIds: string[]): ShellState {
  return { ...state, linkedAccountIds };
}

export function persistable(state: ShellState): ShellState {
  return normalize(state);
}
