"use client";

import { useMemo, useState } from "react";
import { categories, transactions } from "@/lib/demo-data";
import { formatSignedAud } from "@/lib/format";

export function TransactionTable() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((txn) => {
      const matchesCategory = category === "All" || txn.category === category;
      const matchesQuery =
        needle.length === 0 ||
        txn.merchant.toLowerCase().includes(needle) ||
        txn.category.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search merchants"
          className="w-full rounded-full border border-[#dce4df] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#173b31] sm:max-w-xs"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-full border border-[#dce4df] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#173b31]"
        >
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-5 divide-y divide-[#edf0ee]">
        {rows.length === 0 ? (
          <p className="py-8 text-sm text-[#60716a]">No transactions match that search.</p>
        ) : (
          rows.map((txn) => (
            <div className="flex items-center justify-between py-4" key={txn.id}>
              <div>
                <p className="font-semibold">{txn.merchant}</p>
                <p className="mt-1 text-sm text-[#77857f]">
                  {txn.category} · {txn.date}
                </p>
              </div>
              <p className={`font-semibold ${txn.amount > 0 ? "text-[#257155]" : ""}`}>
                {formatSignedAud(txn.amount)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
