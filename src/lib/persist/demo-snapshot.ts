export function isDemoMoneySnapshot(
  files: { length: number },
  transactions: Array<{ sourceFile: string }>,
): boolean {
  return files.length === 0 && transactions.length > 0 && transactions.every((txn) => txn.sourceFile === "demo");
}
