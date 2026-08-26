export const periodLabel = "August 2026";

export const snapshot = {
  income: 5240,
  spending: 3397.4,
  net: 1842.6,
};

export const accounts = [
  {
    id: "everyday",
    name: "Everyday",
    institution: "Commonwealth Bank",
    accountType: "Bank account",
    balance: 1842.6,
  },
  {
    id: "savings",
    name: "Savings",
    institution: "Commonwealth Bank",
    accountType: "Savings account",
    balance: 29150,
  },
  {
    id: "credit",
    name: "Low Rate",
    institution: "ANZ",
    accountType: "Credit card",
    balance: -412.2,
  },
] as const;

export const goals = [
  {
    id: "emergency",
    name: "Emergency fund",
    detail: "Three months of living costs",
    saved: 8400,
    target: 12000,
    monthlyContribution: 400,
  },
  {
    id: "japan",
    name: "Japan trip",
    detail: "Flights and two weeks in April",
    saved: 2150,
    target: 4500,
    monthlyContribution: 250,
  },
  {
    id: "deposit",
    name: "Home deposit",
    detail: "Bit by bit toward a first place",
    saved: 18600,
    target: 80000,
    monthlyContribution: 900,
  },
] as const;

export const budgets = [
  { name: "Groceries", spent: 624, limit: 1480 },
  { name: "Housing", spent: 980, limit: 1485 },
  { name: "Dining", spent: 216, limit: 745 },
  { name: "Transport", spent: 157, limit: 748 },
] as const;

export const transactions = [
  { id: "t1", merchant: "Woolworths", category: "Groceries", date: "25 Aug", amount: -86.4, tags: ["Groceries", "Woolworths"] },
  { id: "t2", merchant: "Netflix", category: "Subscriptions", date: "24 Aug", amount: -18.99, tags: ["Subscriptions", "Streaming"] },
  { id: "t3", merchant: "Salary", category: "Income", date: "18 Aug", amount: 2620, tags: ["Income", "Salary"] },
  { id: "t4", merchant: "Opal", category: "Transport", date: "17 Aug", amount: -42, tags: ["Transport"] },
  { id: "t5", merchant: "Rent", category: "Housing", date: "15 Aug", amount: -980, tags: ["Housing", "Rent"] },
  { id: "t6", merchant: "Bunnings", category: "Shopping", date: "14 Aug", amount: -64.5, tags: ["Shopping"] },
  { id: "t7", merchant: "Transfer to savings", category: "Goals", date: "12 Aug", amount: -400, tags: ["Goals"] },
  { id: "t8", merchant: "Salary", category: "Income", date: "4 Aug", amount: 2620, tags: ["Income", "Salary"] },
  { id: "t9", merchant: "Coles", category: "Groceries", date: "3 Aug", amount: -72.15, tags: ["Groceries", "Coles"] },
  { id: "t10", merchant: "Cafe Sydney", category: "Dining", date: "2 Aug", amount: -28.4, tags: ["Dining", "Coffee"] },
  { id: "t11", merchant: "Salary", category: "Income", date: "18 Jul", amount: 2620, tags: ["Income", "Salary"] },
  { id: "t12", merchant: "Rent", category: "Housing", date: "15 Jul", amount: -980, tags: ["Housing", "Rent"] },
  { id: "t13", merchant: "Woolworths", category: "Groceries", date: "8 Jul", amount: -54.2, tags: ["Groceries", "Woolworths"] },
] as const;

export const categories = ["All", ...Array.from(new Set(transactions.map((txn) => txn.category)))];
