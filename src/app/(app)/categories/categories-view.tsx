"use client";

import { CategoryBookEditor } from "@/components/category-book-editor";
import { useMoneyFlow } from "@/components/money-flow-provider";

export function CategoriesView() {
  const { allTransactions, categoryBook, hasUploads, setCategoryBook, transactions } = useMoneyFlow();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
          <p className="mt-2 max-w-2xl text-[#60716a]">
            Every movement carries one of these categories. Your bank reports each transaction
            against its own label; those route to the categories below when a merchant rule does
            not recognise the shop. Transfers stay unmatched until the other account turns up.
          </p>
        </div>
      </div>

      <CategoryBookEditor
        book={categoryBook}
        onChange={setCategoryBook}
        transactions={transactions}
        allTransactions={allTransactions}
        hasUploads={hasUploads}
      />
    </>
  );
}
