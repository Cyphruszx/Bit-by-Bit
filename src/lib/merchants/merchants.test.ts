import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { aliasSeedCount, matchAlias } from "./aliases";
import { mccDescription, mccRecordCount, mccToCategory, normalizeMcc } from "./mcc";
import { matchNsiBrand, nsiBrandCount } from "./nsi";
import { osmTypeToCategory } from "./osm-types";
import { resolveMerchant } from "./resolve";
import { isCategoryKey } from "@/lib/money-flow/taxonomy";
import nsiAu from "./data/nsi-au-brands.json";
import auAliases from "./data/au-aliases.json";

const ROOT = process.cwd();

describe("MCC map", () => {
  it("vends the greggles list and maps well-known codes onto taxonomy keys", () => {
    assert.equal(mccRecordCount(), 981);
    assert.equal(normalizeMcc("5411"), "5411");
    assert.equal(normalizeMcc(742), "0742");
    assert.match(mccDescription("5411") ?? "", /Grocery/i);

    assert.equal(mccToCategory("5411")?.categoryKey, "groceries");
    assert.equal(mccToCategory("5814")?.categoryKey, "eating-out");
    assert.equal(mccToCategory("5814")?.tag, "Fast Food");
    assert.equal(mccToCategory("5542")?.categoryKey, "car");
    assert.equal(mccToCategory("4111")?.categoryKey, "getting-around");
    assert.equal(mccToCategory("4900")?.categoryKey, "utilities");
    assert.equal(mccToCategory("4814")?.categoryKey, "internet-phone");
    assert.equal(mccToCategory("5912")?.categoryKey, "medical");
    assert.equal(mccToCategory("7011")?.categoryKey, "travel");
    assert.equal(mccToCategory("5200")?.categoryKey, "home-garden");
    assert.equal(mccToCategory("8398")?.categoryKey, "donations");
    assert.equal(mccToCategory("9311")?.categoryKey, "government-tax");
    assert.equal(mccToCategory("0742")?.categoryKey, "pets");
    assert.equal(mccToCategory("9999"), null);
    assert.equal(mccToCategory(undefined), null);
    assert.ok(isCategoryKey(mccToCategory("5411")!.categoryKey));
  });
});

describe("hand-curated AU aliases", () => {
  it("keeps a quality AU seed on existing taxonomy keys", () => {
    const count = aliasSeedCount();
    assert.ok(count >= 150, `expected at least 150 aliases, got ${count}`);
    assert.ok(count <= 400, `expected at most 400 aliases, got ${count}`);
    assert.equal(auAliases._meta.count, count);
    for (const row of auAliases.aliases) {
      assert.ok(isCategoryKey(row.categoryKey), row.alias);
      assert.equal(row.country, "AU");
    }
  });

  it("hits common statement aliases", () => {
    assert.equal(matchAlias("EFTPOS WW METRO 3120")?.canonicalName, "Woolworths Metro");
    assert.equal(matchAlias("WOOLIES BONDI")?.categoryKey, "groceries");
    assert.equal(matchAlias("visa coles 8891")?.categoryKey, "groceries");
    assert.equal(matchAlias("ALDI")?.categoryKey, "groceries");
    assert.equal(matchAlias("COLES EXPRESS")?.categoryKey, "car");
    assert.equal(matchAlias("BUNNINGS WAREHOUSE WAGGA")?.categoryKey, "home-garden");
    assert.equal(matchAlias("OFFICEWORKS")?.categoryKey, "shopping");
    assert.equal(matchAlias("AFTERPAY")?.categoryKey, "debt-payments");
    assert.equal(matchAlias("ZIP PAY")?.categoryKey, "debt-payments");
    assert.equal(matchAlias("HUMM")?.canonicalName, "Humm");
    assert.equal(matchAlias("AGL ENERGY")?.categoryKey, "utilities");
    assert.equal(matchAlias("ORIGIN ENERGY")?.categoryKey, "utilities");
    assert.equal(matchAlias("ENERGYAUSTRALIA")?.categoryKey, "utilities");
    assert.equal(matchAlias("TELSTRA")?.categoryKey, "internet-phone");
    assert.equal(matchAlias("OPTUS")?.categoryKey, "internet-phone");
    assert.equal(matchAlias("VODAFONE")?.categoryKey, "internet-phone");
    assert.equal(matchAlias("MACCAS")?.categoryKey, "eating-out");
    assert.equal(matchAlias("KFC")?.categoryKey, "eating-out");
    assert.equal(matchAlias("HUNGRY JACKS")?.canonicalName, "Hungry Jack's");
    assert.equal(matchAlias("UBER EATS")?.categoryKey, "eating-out");
    assert.equal(matchAlias("UBER *TRIP")?.categoryKey, "getting-around");
    assert.equal(matchAlias("A random cafe")?.categoryKey, undefined);
  });
});

describe("NSI AU brands", () => {
  it("filters to AU locationSet brands and maps OSM types", () => {
    assert.ok(nsiAu.brands.length > 400, `nsi dump ${nsiAu.brands.length}`);
    assert.ok(nsiBrandCount() > 300, `mapped nsi ${nsiBrandCount()}`);
    assert.equal(nsiAu._meta.license, "BSD-3-Clause");
    assert.match(nsiAu._meta.filter, /au/);
    assert.equal(osmTypeToCategory("shop=supermarket")?.categoryKey, "groceries");
    assert.equal(osmTypeToCategory("amenity=fuel")?.categoryKey, "car");
    assert.equal(osmTypeToCategory("amenity=fast_food")?.categoryKey, "eating-out");
    assert.equal(osmTypeToCategory("shop=doityourself")?.categoryKey, "home-garden");
    assert.equal(osmTypeToCategory("amenity=atm"), null);
  });

  it("matches a sample of AU brands that the alias seed does not cover", () => {
    const dimmeys = matchNsiBrand("DIMMEYS MELBOURNE");
    assert.equal(dimmeys?.brand.name, "Dimmeys");
    assert.equal(dimmeys?.categoryKey, "shopping");

    const ally = matchNsiBrand("ALLY FASHION");
    assert.equal(ally?.brand.name, "Ally Fashion");
    assert.equal(ally?.categoryKey, "shopping");

    const bakers = matchNsiBrand("BAKERS DELIGHT");
    assert.equal(bakers?.categoryKey, "groceries");
  });
});

describe("resolver priority", () => {
  it("uses alias, then NSI, then MCC, else null", () => {
    const alias = resolveMerchant("WW METRO BONDI", { mcc: "5812" });
    assert.equal(alias?.source, "alias");
    assert.equal(alias?.categoryKey, "groceries");

    const nsi = resolveMerchant("DIMMEYS", { mcc: "5812" });
    assert.equal(nsi?.source, "nsi");
    assert.equal(nsi?.categoryKey, "shopping");

    const mcc = resolveMerchant("UNKNOWN LOCAL COUNTER 99", { mcc: "5812" });
    assert.equal(mcc?.source, "mcc");
    assert.equal(mcc?.categoryKey, "eating-out");

    assert.equal(resolveMerchant("UNKNOWN LOCAL COUNTER 99"), null);
  });
});

describe("licence files", () => {
  it("retains the NSI BSD-3 copyright notice", () => {
    const notice = readFileSync(path.join(ROOT, "NOTICE"), "utf8");
    const licence = readFileSync(path.join(ROOT, "licenses/name-suggestion-index-BSD-3.txt"), "utf8");
    assert.ok(existsSync(path.join(ROOT, "licenses/name-suggestion-index-BSD-3.txt")));
    assert.match(notice, /Copyright 2026, name-suggestion-index contributors/);
    assert.match(licence, /Copyright 2026, name-suggestion-index contributors/);
    assert.match(licence, /BSD/);
    assert.match(licence, /endorse or promote/);
    assert.match(notice, /endorse/);
  });
});
