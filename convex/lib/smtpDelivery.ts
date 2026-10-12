import type { Address } from "./types";
const emailOf = (value: string | { address: string }) => typeof value === "string" ? value : value.address;
export function smtpDelivery(info: { accepted: (string | { address: string })[]; rejected: (string | { address: string })[] }, requested: Address[]) {
  const accepted = new Set(info.accepted.map(a => emailOf(a).toLowerCase()));
  const rejected = new Set(info.rejected.map(a => emailOf(a).toLowerCase()));
  if (!accepted.size || requested.some(a => !accepted.has(a.email.toLowerCase()) && !rejected.has(a.email.toLowerCase()))) {
    throw new Error("SMTP recipient delivery result is incomplete. Check Sent before retrying.");
  }
  return {
    accepted: requested.filter(a => accepted.has(a.email.toLowerCase())),
    rejected: requested.filter(a => !accepted.has(a.email.toLowerCase()) && rejected.has(a.email.toLowerCase())),
  };
}
