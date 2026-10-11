/** Existing draft bodies are authoritative; fresh composers use the account signature. */
export function initialComposeBody(mode: string, draftHtml: string | undefined, signatureHtml: string | undefined) {
  if (mode === "draft") return draftHtml ?? "";
  return signatureHtml?.trim() ? `<p></p>${signatureHtml}` : "";
}
