/**
 * Three-layer merchant seed: hand AU aliases, NSI AU brands, then MCC.
 *
 * A miss returns null so Core ingest leaves the row for classify / Review.
 * user_overridden and user_rule still outrank this — the seed only writes `rules`.
 */

import { aliasSuggestion, matchAlias } from "@/lib/merchants/aliases";
import { mccToCategory } from "@/lib/merchants/mcc";
import { matchNsiBrand } from "@/lib/merchants/nsi";
import { isCategoryKey, splitSuggestion } from "@/lib/money-flow/taxonomy";

export type MerchantSeedSource = "alias" | "nsi" | "mcc";

export type MerchantResolution = {
  categoryKey: string;
  tag?: string;
  /** Dotted suggestion the existing reader already understands, e.g. `car.fuel`. */
  suggestion: string;
  canonicalName?: string;
  source: MerchantSeedSource;
};

export type ResolveMerchantOptions = {
  mcc?: string | number | null;
};

function suggestionOf(categoryKey: string, tag?: string): string {
  if (!tag) return categoryKey;
  const dotted = `${categoryKey}.${slugify(tag)}`;
  const split = splitSuggestion(dotted);
  return split.tag ? dotted : categoryKey;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function asResolution(
  categoryKey: string,
  source: MerchantSeedSource,
  extra: { tag?: string; suggestion?: string; canonicalName?: string } = {},
): MerchantResolution | null {
  if (!isCategoryKey(categoryKey)) return null;
  const suggestion = extra.suggestion ?? suggestionOf(categoryKey, extra.tag);
  const split = splitSuggestion(suggestion);
  return {
    categoryKey: split.categoryKey,
    ...(split.tag ? { tag: split.tag } : extra.tag ? { tag: extra.tag } : {}),
    suggestion,
    ...(extra.canonicalName ? { canonicalName: extra.canonicalName } : {}),
    source,
  };
}

export function resolveMerchant(
  descriptor: string,
  options: ResolveMerchantOptions = {},
): MerchantResolution | null {
  const alias = matchAlias(descriptor);
  if (alias) {
    return asResolution(alias.categoryKey, "alias", {
      suggestion: aliasSuggestion(alias),
      canonicalName: alias.canonicalName,
      tag: alias.tags[0],
    });
  }

  const nsi = matchNsiBrand(descriptor);
  if (nsi) {
    return asResolution(nsi.categoryKey, "nsi", {
      tag: nsi.tag,
      canonicalName: nsi.brand.name,
    });
  }

  const mcc = mccToCategory(options.mcc);
  if (mcc) {
    return asResolution(mcc.categoryKey, "mcc", { tag: mcc.tag });
  }

  return null;
}
