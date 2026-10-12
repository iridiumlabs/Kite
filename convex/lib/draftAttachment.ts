// A persisted ID survives upload ordering and forward-to-upload conversion.
// Legacy drafts use their immutable source coordinates until materialized.
export function draftAttachmentId(attachment: { id?: string } & (
  | { kind: "upload"; storageId: string }
  | { kind: "forward"; messageId: string; attachmentId: string }
)): string {
  return attachment.id ?? (attachment.kind === "upload"
    ? `upload:${attachment.storageId}`
    : `forward:${attachment.messageId}:${attachment.attachmentId}`);
}
