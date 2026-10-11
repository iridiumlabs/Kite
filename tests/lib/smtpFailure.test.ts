import { expect, test } from "vitest";
import { isDefiniteSmtpFailure } from "../../convex/lib/smtpFailure";

test.each([
  { code: "ESOCKET", syscall: "connect", command: "CONN" },
  { code: "ECONNREFUSED" },
  { code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" },
  { code: "ETIMEDOUT", command: "CONN", message: "Greeting never received" },
  { code: "EDNS", command: "CONN" },
  { code: "EAUTH" },
  { code: "ETLS", command: "STARTTLS" },
  { responseCode: 550, command: "DATA" },
])("a proven pre-acceptance failure releases the reservation: %j", error => {
  expect(isDefiniteSmtpFailure(error)).toBe(true);
});

test.each([
  { code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" },
  { code: "ESOCKET", command: "CONN", syscall: "read" },
  { code: "ETIMEDOUT", command: "CONN", message: "Socket timeout" },
  { code: "ETIMEDOUT", command: "DATA", message: "Connection timeout" },
  { responseCode: 250 },
  new Error("stream interrupted"), null,
])("ambiguous acceptance still blocks ordinary retries: %j", error => {
  expect(isDefiniteSmtpFailure(error)).toBe(false);
});
