import type { SendArgs } from "./backend";

// HTTP file upload bypasses both Convex's general and Node-action argument
// limits. Only small storage references enter the send action.
export async function uploadSendAttachments(
  attachments: SendArgs["attachments"],
  apiKey: string,
  convexUrl: string,
) {
  const decoded = (attachments ?? []).map(att => "contentBase64" in att
    ? { att, bytes: Buffer.from(att.contentBase64, "base64") } : { att });
  if (decoded.reduce((total, item) => total + (item.bytes?.length ?? 0), 0) > 25 * 1024 * 1024) throw new Error("Attachments exceed the 25 MB limit.");
  const url = new URL(convexUrl);
  if (decoded.some(item => item.bytes)) {
    if (url.hostname.endsWith(".convex.cloud")) url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    else if (["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "3210") url.port = "3211";
    else throw new Error("Attachment uploads require a Convex cloud or local deployment URL");
    url.pathname = "/send-attachment";
  }
  const refs = [];
  for (const { att, bytes } of decoded) {
    if (!bytes || !("contentBase64" in att)) { refs.push(att); continue; }
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": att.contentType },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error("Attachment upload failed");
    const { storageId } = await response.json() as { storageId: string };
    refs.push({ storageId, filename: att.filename, contentType: att.contentType, size: bytes.length });
  }
  return refs;
}
