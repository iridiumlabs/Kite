import { beforeEach, expect, test } from "vitest";
import { useUI } from "../../lib/ui/store";

beforeEach(() => useUI.setState({ compose: [] }));

test("repeated Compose requests reuse the same new-message editor", () => {
  const ui = useUI.getState();
  const id = ui.openCompose({ mode: "new", accountId: "sender" });
  ui.setComposeDraft(id, "saved-draft");
  for (let i = 0; i < 10; i++) expect(ui.openCompose({ mode: "new" })).toBe(id);
  expect(useUI.getState().compose).toEqual([
    { id, mode: "new", accountId: "sender", draftId: "saved-draft", minimized: false, expanded: false },
  ]);
});

test("Compose restores and raises a minimized editor without resetting its state", () => {
  const ui = useUI.getState();
  const id = ui.openCompose({ mode: "new" });
  ui.toggleExpandCompose(id);
  ui.minimizeCompose(id);
  ui.openCompose({ mode: "reply", replyToMessageId: "message" });
  expect(ui.openCompose({ mode: "new" })).toBe(id);
  const windows = useUI.getState().compose;
  expect(windows).toHaveLength(2);
  expect(windows.at(-1)).toMatchObject({ id, minimized: false, expanded: true });
});

test("opening a draft already mounted as a new message restores that editor", () => {
  const ui = useUI.getState();
  const id = ui.openCompose({ mode: "new" });
  ui.setComposeDraft(id, "saved-draft");
  expect(ui.openCompose({ mode: "draft", draftId: "saved-draft" })).toBe(id);
  expect(useUI.getState().compose).toHaveLength(1);
});

test("identical reply requests reuse a window but distinct conversations stay independent", () => {
  const ui = useUI.getState();
  const first = ui.openCompose({ mode: "reply", replyToMessageId: "one" });
  expect(ui.openCompose({ mode: "reply", replyToMessageId: "one" })).toBe(first);
  const second = ui.openCompose({ mode: "reply", replyToMessageId: "two" });
  expect(second).not.toBe(first);
  expect(useUI.getState().compose).toHaveLength(2);
});

test("closing a new-message window permits a fresh composer", () => {
  const ui = useUI.getState();
  const first = ui.openCompose({ mode: "new" });
  ui.closeCompose(first);
  expect(ui.openCompose({ mode: "new" })).not.toBe(first);
  expect(useUI.getState().compose).toHaveLength(1);
});
