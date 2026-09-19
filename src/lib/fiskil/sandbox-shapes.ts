/**
 * Live Fiskil Banking Sandbox Data Holder field names.
 *
 * Accounts use `display_name` / `fiskil_id` / `account_id` (no bare `id`/`name`).
 * Transactions use `transaction_id` / `fiskil_id` / `execution_date_time`.
 * These fixtures are reconstructed shapes — not a person's statement rows.
 */

export const SANDBOX_ACCOUNT = {
  fiskil_id: "fia_sandbox_everyday",
  account_id: "acc_sandbox_everyday",
  display_name: "Transaction Account",
  account_number: "12345678",
  product_name: "Transaction",
  product_category: "TRANS_AND_SAVINGS_ACCOUNTS",
  institution: {
    id: "dh_banking_sandbox",
    name: "Banking Sandbox Data Holder",
  },
};

export const SANDBOX_TRANSACTION = {
  fiskil_id: "fit_sandbox_coffee",
  transaction_id: "txn_sandbox_coffee",
  account_id: "acc_sandbox_everyday",
  amount: -12.5,
  description: "Coffee",
  status: "POSTED",
  execution_date_time: "2026-09-10T01:23:45.000Z",
};
