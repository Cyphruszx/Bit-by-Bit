import nsiAu from "@/lib/merchants/data/nsi-au-brands.json";
import { osmTypeToCategory, type OsmCategory } from "@/lib/merchants/osm-types";
import { containsTokenSequence, merchantTokens } from "@/lib/merchants/normalize";

export type NsiBrand = {
  name: string;
  names: string[];
  osm: string;
  wikidata?: string;
};

type IndexedBrand = {
  brand: NsiBrand;
  category: OsmCategory;
  needles: string[][];
  longest: number;
};

function indexBrands(): IndexedBrand[] {
  const indexed: IndexedBrand[] = [];
  for (const brand of nsiAu.brands as NsiBrand[]) {
    const category = osmTypeToCategory(brand.osm);
    if (!category) continue;
    const needles: string[][] = [];
    const seen = new Set<string>();
    for (const name of [brand.name, ...brand.names]) {
      const tokens = merchantTokens(name);
      if (tokens.length === 0) continue;
      if (tokens.length === 1 && tokens[0]!.length < 3) continue;
      const key = tokens.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      needles.push(tokens);
    }
    if (needles.length === 0) continue;
    needles.sort((a, b) => b.join(" ").length - a.join(" ").length);
    indexed.push({
      brand,
      category,
      needles,
      longest: needles[0]!.join(" ").length,
    });
  }
  indexed.sort((a, b) => b.longest - a.longest);
  return indexed;
}

const INDEX = indexBrands();

export function nsiBrandCount(): number {
  return INDEX.length;
}

export type NsiMatch = {
  brand: NsiBrand;
  categoryKey: string;
  tag?: string;
};

export function matchNsiBrand(descriptor: string): NsiMatch | null {
  const tokens = merchantTokens(descriptor);
  if (tokens.length === 0) return null;
  const joined = tokens.join(" ");

  let best: { match: NsiMatch; length: number } | null = null;
  for (const row of INDEX) {
    for (const needle of row.needles) {
      const length = needle.join(" ").length;
      if (best && length < best.length) break;
      const hit = needle.join(" ") === joined || containsTokenSequence(tokens, needle);
      if (!hit) continue;
      const match: NsiMatch = {
        brand: row.brand,
        categoryKey: row.category.categoryKey,
        ...(row.category.tag ? { tag: row.category.tag } : {}),
      };
      if (!best || length > best.length) best = { match, length };
      break;
    }
  }
  return best?.match ?? null;
}
