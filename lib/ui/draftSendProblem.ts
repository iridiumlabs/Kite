export function draftSendProblem(draft?: { status: string; sendError?: string } | null): string | undefined {
  if (draft?.status === "uncertain") return "Delivery is uncertain. Check Sent before sending again.";
  if (draft?.status === "failed") return `Send failed: ${draft.sendError || "Message was not delivered"}`;
  return undefined;
}
