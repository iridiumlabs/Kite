import { expect, test } from "vitest";
import { validateMailServer } from "../../convex/lib/mailServers";

test.each(["localhost", "127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "::ffff:127.0.0.1",
  "attacker.example", "mail.spacemail.com.attacker.example", "https://mail.spacemail.com", "mail.spacemail.com."])(
  "rejects arbitrary and private-network destination %s", host => {
    expect(() => validateMailServer("imap", host, 993, true)).toThrow("Unsupported mail server");
    expect(() => validateMailServer("smtp", host, 465, true)).toThrow("Unsupported mail server");
  },
);

test("allows only exact supported hosts and mail port/TLS combinations", () => {
  expect(validateMailServer("imap", " MAIL.SPACEMAIL.COM ", 993, true)).toBe("mail.spacemail.com");
  expect(validateMailServer("imap", "imap.ethereal.email", 993, true)).toBe("imap.ethereal.email");
  expect(validateMailServer("smtp", "smtp.ethereal.email", 587, false)).toBe("smtp.ethereal.email");
  expect(validateMailServer("smtp", "mail.spacemail.com", 465, true)).toBe("mail.spacemail.com");
  for (const [port, secure] of [[80, false], [22, true], [993, false]] as const) {
    expect(() => validateMailServer("imap", "mail.spacemail.com", port, secure)).toThrow("Unsupported mail port");
  }
  expect(() => validateMailServer("smtp", "mail.spacemail.com", 465, false)).toThrow("Unsupported mail port");
  expect(() => validateMailServer("smtp", "mail.spacemail.com", 587, true)).toThrow("Unsupported mail port");
});
