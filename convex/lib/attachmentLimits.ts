// Convex return values cap at 16 MiB. Keep binary data plus base64 transport
// encoding and metadata comfortably below that cap for both action hops.
export const RECEIVED_ATTACHMENT_MAX = 10 * 1024 * 1024;

export function checkReceivedAttachmentSize(bytes: number) {
  if (bytes > RECEIVED_ATTACHMENT_MAX) {
    throw new Error("Attachment exceeds the 10 MB download/forward limit.");
  }
}
