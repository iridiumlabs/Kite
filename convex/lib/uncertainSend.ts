import type { Doc } from "../_generated/dataModel";

// Node actions time out within ten minutes. A crashed attempt without a
// terminal write must age out before a user can override its reservation.
export const UNCERTAIN_STALE_MS = 15 * 60 * 1000;
export function uncertainResolutionOptions(log: Doc<"sendLog">, now: number) {
  const stale = (log.uncertainSince ?? log.createdAt) <= now - UNCERTAIN_STALE_MS;
  const finished = log.attemptFinishedAt !== undefined && log.error !== undefined;
  const ready = log.status === "uncertain" && (finished || stale);
  return {
    canConfirmDelivered: ready && (log.smtpAcceptedAt === undefined || !log.rejectedRecipients?.length),
    canConfirmNotDelivered: ready && log.smtpAcceptedAt === undefined,
  };
}
