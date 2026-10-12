// Nodemailer uses command "CONN" even for disconnects after DATA, so that
// field alone is NOT evidence that a message was never accepted.
export function isDefiniteSmtpFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { responseCode?: number; code?: string; command?: string; syscall?: string; message?: string };
  if (typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode < 600) return true;
  if (["EDNS", "EAUTH", "EENVELOPE", "ETLS", "EREQUIRETLS", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(e.code ?? "")) return true;
  if (e.command !== "CONN") return false;
  // Node's connect errors are wrapped as ESOCKET but retain their syscall.
  if (e.code === "ESOCKET" && e.syscall === "connect") return true;
  // These are the library's pre-session timers, not its generic Socket timeout.
  return e.code === "ETIMEDOUT" && (e.message === "Connection timeout" || e.message === "Greeting never received");
}
