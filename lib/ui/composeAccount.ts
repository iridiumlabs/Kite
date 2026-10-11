import type { AccountInfo } from "./types";

/** Explicit draft/reply/manual selection wins over the new-message default. */
export function composeAccount(
  accounts: AccountInfo[],
  accountId?: string,
  defaultAccountId?: string,
): AccountInfo | undefined {
  return accounts.find(a => a.id === accountId)
    ?? accounts.find(a => a.id === defaultAccountId)
    ?? accounts[0];
}
