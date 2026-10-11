/** Existing draft bodies are authoritative; fresh composers use the account signature. */
export function initialComposeBody(mode: string, draftHtml: string | undefined, signatureHtml: string | undefined) {
  if (mode === "draft") return draftHtml ?? "";
  return signatureHtml?.trim() ? `<p></p>${signatureHtml}` : "";
}

/** Compare parsed editor HTML, not raw signature HTML; never replace user content. */
export function replacementComposeSignature(mode: string, currentHtml: string, initializedHtml: string | undefined, signatureHtml: string | undefined) {
  if (mode === "draft" || initializedHtml === undefined || currentHtml !== initializedHtml) return undefined;
  return initialComposeBody(mode, undefined, signatureHtml);
}
