// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
const createTransport = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import { smtpTransport } from "../../convex/node/accountsOps";

beforeEach(() => createTransport.mockClear());

test("SMTP validates saved destinations before constructing a transport", () => {
  expect(() => smtpTransport({
    host: "127.0.0.1", port: 465, secure: true, username: "test", password: "test",
  })).toThrow("Unsupported mail server");
  expect(createTransport).not.toHaveBeenCalled();
});

test("SMTP submission on 587 requires STARTTLS, rather than allowing downgrade", () => {
  smtpTransport({ host: "smtp.ethereal.email", port: 587, secure: false, username: "test", password: "test" });
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.ethereal.email", requireTLS: true }));
});
