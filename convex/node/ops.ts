"use node";

import { internalAction } from "../_generated/server";

// Phase 2: claims the account syncLocks lease and applies pendingOps over
// IMAP. Mutations enqueue ops and schedule this after commit.
export const processOps = internalAction({
  args: {},
  handler: async () => {},
});
