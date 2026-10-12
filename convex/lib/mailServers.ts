type Protocol = "imap" | "smtp";

// Kite supports Spacemail; Ethereal is the public service used by live tests.
// Exact trusted hostnames avoid attacker-controlled DNS and private-network
// destinations. Do not replace this with suffix matching or user allowlists.
const HOSTS: Record<Protocol, ReadonlySet<string>> = {
  imap: new Set(["mail.spacemail.com", "imap.ethereal.email"]),
  smtp: new Set(["mail.spacemail.com", "smtp.ethereal.email"]),
};

export function validateMailServer(
  protocol: Protocol,
  host: string,
  port: number,
  secure: boolean,
): string {
  const normalized = host.trim().toLowerCase();
  if (!HOSTS[protocol].has(normalized)) {
    throw new Error("Unsupported mail server. Use Spacemail or Ethereal mail endpoints.");
  }
  const valid = protocol === "imap"
    ? port === 993 && secure
    : (port === 465 && secure) || (port === 587 && !secure);
  if (!valid) throw new Error("Unsupported mail port or TLS settings.");
  return normalized;
}
