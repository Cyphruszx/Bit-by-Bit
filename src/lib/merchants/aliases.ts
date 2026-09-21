import auAliasSeed from "@/lib/merchants/data/au-aliases.json";
import { containsTokenSequence, merchantTokens } from "@/lib/merchants/normalize";
import { isCategoryKey, splitSuggestion } from "@/lib/money-flow/taxonomy";

export type AliasRow = {
  alias: string;
  canonicalName: string;
  categoryKey: string;
  tags: string[];
  country?: string;
  source?: string;
};

type AliasIndexRow = AliasRow & {
  tokens: string[];
  needle: string;
};

const ROWS: AliasIndexRow[] = (auAliasSeed.aliases as AliasRow[])
  .map((row) => {
    const tokens = merchantTokens(row.alias);
    return { ...row, tokens, needle: tokens.join(" ") };
  })
  .filter((row) => row.tokens.length > 0 && isCategoryKey(row.categoryKey))
  .sort((a, b) => b.needle.length - a.needle.length || b.tokens.length - a.tokens.length);

export function aliasSeedCount(): number {
  return ROWS.length;
}

export function matchAlias(descriptor: string): AliasRow | null {
  const tokens = merchantTokens(descriptor);
  if (tokens.length === 0) return null;
  const joined = tokens.join(" ");

  for (const row of ROWS) {
    if (row.needle === joined) return row;
  }

  for (const row of ROWS) {
    if (row.tokens.length === 1 && row.tokens[0]!.length <= 2) {
      if (tokens.includes(row.tokens[0]!)) return row;
      continue;
    }
    if (containsTokenSequence(tokens, row.tokens)) return row;
  }

  return null;
}

export function aliasSuggestion(row: AliasRow): string {
  const tag = row.tags[0];
  if (!tag) return row.categoryKey;
  const dotted = `${row.categoryKey}.${tag}`;
  const split = splitSuggestion(dotted);
  return split.tag ? dotted : row.categoryKey;
}
