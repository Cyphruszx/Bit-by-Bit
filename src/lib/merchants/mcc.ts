/**
 * Coarse MCC → BitbyBit taxonomy key.
 *
 * greggles/mcc-codes (Unlicense) is vendored as descriptions; this map is ours.
 * Unknown or unmapped codes return null so Review still sees the row.
 */

import mccCodes from "@/lib/merchants/data/mcc-codes.json";
import { isCategoryKey } from "@/lib/money-flow/taxonomy";

export type MccRecord = {
  mcc: string;
  description: string;
};

const DESCRIPTIONS = new Map((mccCodes as MccRecord[]).map((row) => [normalizeMcc(row.mcc) ?? "", row]));

/** Four-digit MCC, or null when the value is not a code. */
export function normalizeMcc(raw: string | number | undefined | null): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length > 4) return digits.slice(0, 4);
  return digits.padStart(4, "0");
}

export function mccDescription(mcc: string | number | undefined | null): string | null {
  const code = normalizeMcc(mcc);
  if (!code) return null;
  return DESCRIPTIONS.get(code)?.description ?? null;
}

export function mccRecordCount(): number {
  return DESCRIPTIONS.size;
}

type Range = {
  from: number;
  to: number;
  categoryKey: string;
  tag?: string;
};

/**
 * ISO 18245 / scheme ranges, filed onto Spec 8 keys. Specific well-known codes
 * sit in EXACT and win over the range they fall in.
 */
const RANGES: Range[] = [
  { from: 742, to: 742, categoryKey: "pets", tag: "Veterinary Services" },
  { from: 780, to: 780, categoryKey: "home-garden", tag: "Home Improvement" },
  { from: 1520, to: 1799, categoryKey: "home-garden", tag: "Home Improvement" },
  { from: 3000, to: 3299, categoryKey: "travel", tag: "Flights" },
  { from: 3351, to: 3441, categoryKey: "travel", tag: "Rental Cars" },
  { from: 3501, to: 3790, categoryKey: "travel", tag: "Hotels" },
  { from: 4011, to: 4011, categoryKey: "getting-around", tag: "Public Transport" },
  { from: 4111, to: 4112, categoryKey: "getting-around", tag: "Public Transport" },
  { from: 4121, to: 4121, categoryKey: "getting-around", tag: "Taxis & Ride Shares" },
  { from: 4131, to: 4131, categoryKey: "getting-around", tag: "Public Transport" },
  { from: 4411, to: 4457, categoryKey: "travel", tag: "Transport Abroad" },
  { from: 4511, to: 4582, categoryKey: "travel", tag: "Flights" },
  { from: 4722, to: 4723, categoryKey: "travel", tag: "Other Travel" },
  { from: 4784, to: 4784, categoryKey: "getting-around", tag: "Tolls" },
  { from: 4789, to: 4789, categoryKey: "getting-around", tag: "Other Transportation" },
  { from: 4812, to: 4816, categoryKey: "internet-phone", tag: "Telephone" },
  { from: 4821, to: 4821, categoryKey: "internet-phone", tag: "Telephone" },
  { from: 4829, to: 4829, categoryKey: "transfers", tag: "Other Transfer" },
  { from: 4899, to: 4899, categoryKey: "internet-phone", tag: "Internet & Cable" },
  { from: 4900, to: 4900, categoryKey: "utilities", tag: "Other Utilities" },
  { from: 5013, to: 5013, categoryKey: "car", tag: "Automotive" },
  { from: 5021, to: 5021, categoryKey: "home-garden", tag: "Furniture" },
  { from: 5039, to: 5039, categoryKey: "home-garden", tag: "Hardware" },
  { from: 5044, to: 5046, categoryKey: "shopping", tag: "Electronics" },
  { from: 5047, to: 5047, categoryKey: "medical", tag: "Other Medical" },
  { from: 5065, to: 5074, categoryKey: "home-garden", tag: "Hardware" },
  { from: 5094, to: 5094, categoryKey: "shopping", tag: "Clothing & Accessories" },
  { from: 5111, to: 5111, categoryKey: "shopping", tag: "Office Supplies" },
  { from: 5122, to: 5122, categoryKey: "medical", tag: "Pharmacy" },
  { from: 5131, to: 5139, categoryKey: "shopping", tag: "Clothing" },
  { from: 5172, to: 5172, categoryKey: "car", tag: "Fuel" },
  { from: 5192, to: 5192, categoryKey: "shopping", tag: "Books & News" },
  { from: 5193, to: 5198, categoryKey: "home-garden", tag: "Home Improvement" },
  { from: 5200, to: 5261, categoryKey: "home-garden", tag: "Hardware" },
  { from: 5300, to: 5300, categoryKey: "groceries", tag: "Groceries" },
  { from: 5309, to: 5399, categoryKey: "shopping", tag: "Department Stores" },
  { from: 5411, to: 5499, categoryKey: "groceries", tag: "Groceries" },
  { from: 5511, to: 5599, categoryKey: "car", tag: "Automotive" },
  { from: 5541, to: 5542, categoryKey: "car", tag: "Fuel" },
  { from: 5611, to: 5699, categoryKey: "shopping", tag: "Clothing" },
  { from: 5712, to: 5722, categoryKey: "home-garden", tag: "Furniture" },
  { from: 5732, to: 5734, categoryKey: "shopping", tag: "Electronics" },
  { from: 5733, to: 5735, categoryKey: "entertainment", tag: "Music & Audio" },
  { from: 5811, to: 5814, categoryKey: "eating-out", tag: "Restaurant" },
  { from: 5815, to: 5818, categoryKey: "entertainment", tag: "Software" },
  { from: 5912, to: 5912, categoryKey: "medical", tag: "Pharmacy" },
  { from: 5921, to: 5921, categoryKey: "eating-out", tag: "Alcohol" },
  { from: 5931, to: 5937, categoryKey: "shopping", tag: "Other Merchandise" },
  { from: 5940, to: 5941, categoryKey: "shopping", tag: "Sporting Goods" },
  { from: 5942, to: 5943, categoryKey: "shopping", tag: "Books & News" },
  { from: 5944, to: 5944, categoryKey: "shopping", tag: "Clothing & Accessories" },
  { from: 5945, to: 5946, categoryKey: "shopping", tag: "Hobbies" },
  { from: 5947, to: 5947, categoryKey: "shopping", tag: "Gifts" },
  { from: 5960, to: 5960, categoryKey: "insurance", tag: "Insurance" },
  { from: 5962, to: 5962, categoryKey: "travel", tag: "Other Travel" },
  { from: 5964, to: 5969, categoryKey: "shopping", tag: "Online Marketplaces" },
  { from: 5970, to: 5973, categoryKey: "shopping", tag: "Hobbies" },
  { from: 5975, to: 5976, categoryKey: "medical", tag: "Other Medical" },
  { from: 5977, to: 5977, categoryKey: "personal-care", tag: "Hair & Beauty" },
  { from: 5983, to: 5983, categoryKey: "car", tag: "Fuel" },
  { from: 5992, to: 5992, categoryKey: "shopping", tag: "Gifts" },
  { from: 5993, to: 5993, categoryKey: "shopping", tag: "Tobacco & Vape" },
  { from: 5994, to: 5994, categoryKey: "shopping", tag: "Books & News" },
  { from: 5995, to: 5995, categoryKey: "pets", tag: "Pet Supplies" },
  { from: 5999, to: 5999, categoryKey: "shopping", tag: "Other Merchandise" },
  { from: 6010, to: 6012, categoryKey: "bank-fees", tag: "Bank Fees" },
  { from: 6051, to: 6051, categoryKey: "bank-fees", tag: "Other Bank Fees" },
  { from: 6211, to: 6211, categoryKey: "invest", tag: "Brokerage Fee" },
  { from: 6300, to: 6399, categoryKey: "insurance", tag: "Insurance" },
  { from: 6513, to: 6513, categoryKey: "rent-mortgage", tag: "Rent" },
  { from: 6540, to: 6540, categoryKey: "transfers", tag: "Other Transfer" },
  { from: 7011, to: 7033, categoryKey: "travel", tag: "Hotels" },
  { from: 7210, to: 7217, categoryKey: "personal-care", tag: "Laundry & Dry Cleaning" },
  { from: 7230, to: 7230, categoryKey: "personal-care", tag: "Hair & Beauty" },
  { from: 7296, to: 7299, categoryKey: "personal-care", tag: "Other Personal Care" },
  { from: 7512, to: 7519, categoryKey: "travel", tag: "Rental Cars" },
  { from: 7523, to: 7523, categoryKey: "getting-around", tag: "Parking" },
  { from: 7531, to: 7549, categoryKey: "car", tag: "Servicing" },
  { from: 7832, to: 7841, categoryKey: "entertainment", tag: "TV & Movies" },
  { from: 7911, to: 7994, categoryKey: "entertainment", tag: "Events & Amusement" },
  { from: 7995, to: 7995, categoryKey: "entertainment", tag: "Casinos & Gambling" },
  { from: 7996, to: 7999, categoryKey: "entertainment", tag: "Events & Amusement" },
  { from: 8011, to: 8099, categoryKey: "medical", tag: "GP & Specialists" },
  { from: 8111, to: 8111, categoryKey: "bank-fees", tag: "Professional Fees" },
  { from: 8211, to: 8299, categoryKey: "education-childcare", tag: "Education" },
  { from: 8351, to: 8351, categoryKey: "education-childcare", tag: "Childcare" },
  { from: 8398, to: 8398, categoryKey: "donations", tag: "Charity" },
  { from: 8641, to: 8699, categoryKey: "donations", tag: "Donations" },
  { from: 8931, to: 8931, categoryKey: "bank-fees", tag: "Professional Fees" },
  { from: 9211, to: 9223, categoryKey: "government-tax", tag: "Fines" },
  { from: 9311, to: 9311, categoryKey: "government-tax", tag: "Tax Payment" },
  { from: 9399, to: 9402, categoryKey: "government-tax", tag: "Government Services" },
];

const EXACT: Record<string, { categoryKey: string; tag?: string }> = {
  "0742": { categoryKey: "pets", tag: "Veterinary Services" },
  "4111": { categoryKey: "getting-around", tag: "Public Transport" },
  "4121": { categoryKey: "getting-around", tag: "Taxis & Ride Shares" },
  "4784": { categoryKey: "getting-around", tag: "Tolls" },
  "4814": { categoryKey: "internet-phone", tag: "Mobile" },
  "4900": { categoryKey: "utilities", tag: "Gas & Electricity" },
  "5200": { categoryKey: "home-garden", tag: "Hardware" },
  "5300": { categoryKey: "groceries", tag: "Groceries" },
  "5310": { categoryKey: "shopping", tag: "Department Stores" },
  "5311": { categoryKey: "shopping", tag: "Department Stores" },
  "5331": { categoryKey: "shopping", tag: "Department Stores" },
  "5411": { categoryKey: "groceries", tag: "Groceries" },
  "5499": { categoryKey: "groceries", tag: "Groceries" },
  "5541": { categoryKey: "car", tag: "Fuel" },
  "5542": { categoryKey: "car", tag: "Fuel" },
  "5732": { categoryKey: "shopping", tag: "Electronics" },
  "5812": { categoryKey: "eating-out", tag: "Restaurant" },
  "5813": { categoryKey: "eating-out", tag: "Alcohol" },
  "5814": { categoryKey: "eating-out", tag: "Fast Food" },
  "5912": { categoryKey: "medical", tag: "Pharmacy" },
  "5921": { categoryKey: "eating-out", tag: "Alcohol" },
  "5968": { categoryKey: "entertainment", tag: "Streaming" },
  "5995": { categoryKey: "pets", tag: "Pet Supplies" },
  "6011": { categoryKey: "bank-fees", tag: "ATM Fees" },
  "6300": { categoryKey: "insurance", tag: "Insurance" },
  "7011": { categoryKey: "travel", tag: "Hotels" },
  "7230": { categoryKey: "personal-care", tag: "Hair & Beauty" },
  "7298": { categoryKey: "personal-care", tag: "Hair & Beauty" },
  "7512": { categoryKey: "travel", tag: "Rental Cars" },
  "7523": { categoryKey: "getting-around", tag: "Parking" },
  "7538": { categoryKey: "car", tag: "Servicing" },
  "7832": { categoryKey: "entertainment", tag: "TV & Movies" },
  "7941": { categoryKey: "entertainment", tag: "Sport" },
  "7995": { categoryKey: "entertainment", tag: "Casinos & Gambling" },
  "8011": { categoryKey: "medical", tag: "GP & Specialists" },
  "8021": { categoryKey: "medical", tag: "Dental" },
  "8042": { categoryKey: "medical", tag: "Optical" },
  "8043": { categoryKey: "medical", tag: "Optical" },
  "8062": { categoryKey: "medical", tag: "Other Medical" },
  "8099": { categoryKey: "medical", tag: "Other Medical" },
  "8211": { categoryKey: "education-childcare", tag: "Education" },
  "8220": { categoryKey: "education-childcare", tag: "Education" },
  "8351": { categoryKey: "education-childcare", tag: "Childcare" },
  "8398": { categoryKey: "donations", tag: "Charity" },
  "9311": { categoryKey: "government-tax", tag: "Tax Payment" },
  "9399": { categoryKey: "government-tax", tag: "Government Services" },
};

export type MccCategory = {
  categoryKey: string;
  tag?: string;
};

export function mccToCategory(mcc: string | number | undefined | null): MccCategory | null {
  const code = normalizeMcc(mcc);
  if (!code) return null;
  const exact = EXACT[code];
  if (exact && isCategoryKey(exact.categoryKey)) return exact;
  const n = Number(code);
  if (!Number.isFinite(n)) return null;
  for (const range of RANGES) {
    if (n >= range.from && n <= range.to && isCategoryKey(range.categoryKey)) {
      return { categoryKey: range.categoryKey, ...(range.tag ? { tag: range.tag } : {}) };
    }
  }
  return null;
}
