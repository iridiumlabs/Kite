import type { SendMailOptions } from "nodemailer";

export const DEV_MAILBOX_NAMES = ["Dev Personal", "Dev Work"] as const;
export type DevMailFixture = { mail: SendMailOptions; flags: string[]; folder: "inbox" | "sent" | "archive" | "trash" };

export function devMailFixtures(email: string, work: boolean, now = Date.now()): DevMailFixture[] {
  const prefix = work ? "work" : "personal";
  const subject = work ? "Launch review — Thursday" : "Weekend plans 🌿";
  const names = work ? ["Maya Chen", "Alex Rivera", "Sam Patel"] : ["Emma Wilson", "Leo Martin", "Nora Davis"];
  const sender = (i: number) => ({ name: names[i % 3], address: `friend${i % 3}@kite-test.example` });
  const id = (i: number) => `<kite-dev-${prefix}-${i}@kite-test.example>`;
  const subjects = [subject, `Re: ${subject}`, `Re: ${subject}`,
    work ? "Design handoff and checklist" : "Your trip itinerary",
    work ? "Weekly product digest" : "The Sunday reading list",
    work ? "Invoice for this month" : "Your order is on its way",
    "A longer note with a few thoughts", "Quick question", "Café tomorrow? ☕",
    "Notes from last month", "Old notification", "Thanks — see you soon"];
  return subjects.map((title, i) => {
    const text = i === 6
      ? Array.from({ length: 14 }, (_, n) => `Section ${n + 1}: This is a longer sample email for testing scrolling, selection, and the reader layout. There is no real personal information here.`).join("\n\n")
      : i === 1 ? "Thursday works! Could we start at 10?\n\n> Here are the plans for this week."
      : i === 2 ? "Perfect, see you then. I’ll bring the notes."
      : `Hi!\n\n${title}. This is sample ${work ? "work" : "personal"} mail for testing Kite. You can archive, delete, reply, or move it safely.\n\n${names[i % 3]}`;
    const mail: SendMailOptions = {
      from: i === 11 ? { name: work ? "Dev Work" : "Dev Personal", address: email } : sender(i),
      to: i === 11 ? sender(0) : email,
      subject: title, text, messageId: id(i), date: new Date(now - (12 - i) * 3_600_000),
    };
    if (i === 1 || i === 2) {
      mail.inReplyTo = id(i - 1);
      mail.references = Array.from({ length: i }, (_, n) => id(n));
    }
    if (i === 3) {
      mail.html = '<h2>Your notes are ready</h2><p>Here is a formatted email with <strong>bold text</strong>, a list, and an embedded image.</p><ul><li>Review the checklist</li><li>Try downloading the attachment</li></ul><img src="cid:kite-sample" width="32" height="32" alt="Sample pixel">';
      mail.attachments = [
        { filename: "checklist.csv", content: "task,status\nReview layout,done\nTest attachments,pending\n", contentType: "text/csv" },
        { filename: "sample.png", content: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), contentType: "image/png", cid: "kite-sample" },
      ];
    }
    if (i === 4 || i === 5) {
      mail.headers = { "List-Unsubscribe": "<mailto:unsubscribe@kite-test.example>", Precedence: "bulk" };
      mail.html = `<h2>${title}</h2><p>A fictional newsletter or receipt for testing the Other inbox.</p><p>Total: $24.00</p>`;
    }
    return { mail, flags: [...(i % 3 === 0 ? ["\\Seen"] : []), ...(i === 0 || i === 3 ? ["\\Flagged"] : [])],
      folder: i === 9 ? "archive" : i === 10 ? "trash" : i === 11 ? "sent" : "inbox" };
  });
}
