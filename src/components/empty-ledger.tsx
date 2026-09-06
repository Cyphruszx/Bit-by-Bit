import Link from "next/link";

/**
 * What a page says when nothing has been uploaded, in place of figures that would all
 * read zero. Nothing here is a number, so nothing here can be mistaken for the person's own.
 */
export function EmptyLedger({ children }: { children?: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl border border-dashed border-line-dashed bg-surface p-8 text-center">
      <h2 className="text-lg font-bold">No statements yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {children ??
          "Upload a bank statement, spreadsheet, PDF or photo and BitbyBit will read it into money in, money out and what that leaves."}
      </p>
      <Link
        href="/upload"
        className="mt-5 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-on-accent"
      >
        Upload a statement
      </Link>
    </section>
  );
}
