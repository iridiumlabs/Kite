/** Pointer navigation gets a short crossfade; shortcuts remain immediate. */
export function readerNavigationOptions(input: string | null) {
  return {
    scroll: false,
    transitionTypes: input === "pointer" ? ["mail-reader"] : [],
  };
}
