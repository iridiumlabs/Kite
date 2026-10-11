import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ComposeLayer } from "../../components/containers/ComposeLayer";
import { CommandPalette } from "../../components/mail/CommandPalette";
import { SearchField } from "../../components/mail/ListHeader";
import { useUI } from "../../lib/ui/store";
import { ComposeWindow, type ComposeWindowProps } from "../../components/compose/ComposeWindow";
import { ExpandIcon, RestoreIcon } from "../../components/icons";

const viewport = vi.hoisted(() => ({ mobile: false }));

// Inspect component output and invoke handlers without a browser or DOM renderer.
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: <T,>(value: T) => ({ current: value }),
  useLayoutEffect: () => {},
}));
vi.mock("convex/react", () => ({ useQuery: () => ({ defaultAccountId: "second" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("../../lib/ui/useMediaQuery", () => ({ useMediaQuery: () => viewport.mobile }));
vi.mock("../../lib/ui/store", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/ui/store")>();
  return {
    useUI: Object.assign(
      (selector: (state: ReturnType<typeof actual.useUI.getState>) => unknown) => selector(actual.useUI.getState()),
      actual.useUI,
    ),
  };
});

beforeEach(() => {
  viewport.mobile = false;
  useUI.setState({ compose: [], paletteOpen: false, sidebarOpen: false });
});

function element(value: unknown): ReactElement<Record<string, unknown>> {
  if (!isValidElement(value)) throw new Error("Expected an element");
  return value as ReactElement<Record<string, unknown>>;
}

function composer() {
  return ComposeLayer({ accounts: [], categories: [] });
}

const searchProps = {
  open: true,
  onClose: vi.fn(),
  query: "",
  onQueryChange: vi.fn(),
  results: [],
  onOpenThread: vi.fn(),
  onServerSearch: vi.fn(),
  commands: [],
};

test("Compose opens, unmounts immediately on close and can open again", () => {
  expect(composer()).toBeNull();
  const first = useUI.getState().openCompose({ mode: "new" });
  const layer = element(composer());
  const surfaces = layer.props.children as ReactElement<Record<string, unknown>>[];
  expect(surfaces).toHaveLength(1);
  expect(surfaces[0].type).toBe("div");
  expect(surfaces[0].props.className).toBe("compose-surface pointer-events-auto");
  expect(surfaces[0].props.initial).toBeUndefined();
  expect(surfaces[0].props.exit).toBeUndefined();
  expect(element(surfaces[0].props.children).props.defaultAccountId).toBe("second");
  useUI.getState().closeCompose(first);
  expect(composer()).toBeNull();
  useUI.getState().openCompose({ mode: "new" });
  expect(element(composer()).props.children).toHaveLength(1);
});

test("Search trigger opens a controlled dialog with portalled backdrop and focused input", () => {
  const trigger = SearchField({ onOpen: () => useUI.getState().setPaletteOpen(true) });
  trigger.props.onClick();
  const root = element(CommandPalette({ ...searchProps, open: useUI.getState().paletteOpen }));
  expect(root.type).toBe(Dialog.Root);
  expect(root.props.open).toBe(true);
  const portal = element(root.props.children);
  expect(portal.type).toBe(Dialog.Portal);
  const [backdrop, popup] = portal.props.children as ReactElement<Record<string, unknown>>[];
  expect(backdrop.type).toBe(Dialog.Backdrop);
  expect(popup.type).toBe(Dialog.Popup);
  expect(popup.props.initialFocus).toEqual({ current: null });
  expect(popup.props.className).not.toContain("dialog-popup");
  const change = root.props.onOpenChange as (open: boolean) => void;
  searchProps.onClose.mockClear();
  change(true);
  expect(searchProps.onClose).not.toHaveBeenCalled();
  change(false);
  expect(searchProps.onClose).toHaveBeenCalledOnce();
});

test("Compose restores without leaving Search or the mailbox drawer over it", () => {
  const ui = useUI.getState();
  const id = ui.openCompose({ mode: "new" });
  ui.minimizeCompose(id);
  useUI.setState({ paletteOpen: true, sidebarOpen: true });
  expect(ui.openCompose({ mode: "new" })).toBe(id);
  expect(useUI.getState()).toMatchObject({ paletteOpen: false, sidebarOpen: false });
  expect(useUI.getState().compose).toHaveLength(1);
  expect(useUI.getState().compose[0].minimized).toBe(false);
});

function findButton(node: unknown, label: string): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(child => findButton(child, label)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  const current = element(node);
  if (current.type === "button" && current.props["aria-label"] === label) return current;
  return findButton(current.props.children, label);
}

test("Expand and Restore update the icon and pressed state without replacing the draft", () => {
  const ui = useUI.getState();
  const id = ui.openCompose({ mode: "new" });
  ui.setComposeDraft(id, "saved-draft");
  const props: ComposeWindowProps = {
    subject: "Unsent message", status: "saved", fromLabel: null,
    to: [], cc: [], bcc: [], showCc: false, showBcc: false,
    toInput: null, subjectInput: null, editor: null, attachments: [],
    onMinimize: vi.fn(), onClose: vi.fn(), onSend: vi.fn(), onAttach: vi.fn(),
    onInsertLink: vi.fn(), onSchedule: null, onDiscard: vi.fn(),
    onExpand: () => ui.toggleExpandCompose(id),
  };
  const expand = findButton(ComposeWindow({ ...props, expanded: false }), "Expand")!;
  expect(expand.props["aria-pressed"]).toBe(false);
  expect(element(expand.props.children).type).toBe(ExpandIcon);
  (expand.props.onClick as () => void)();
  expect(useUI.getState().compose[0].expanded).toBe(true);
  const restore = findButton(ComposeWindow({ ...props, expanded: true }), "Restore size")!;
  expect(restore.props["aria-pressed"]).toBe(true);
  expect(restore.props.title).toBe("Restore size");
  expect(element(restore.props.children).type).toBe(RestoreIcon);
  (restore.props.onClick as () => void)();
  expect(useUI.getState().compose).toHaveLength(1);
  expect(useUI.getState().compose[0]).toMatchObject({ id, draftId: "saved-draft", expanded: false });
});

test("responsive compose layouts keep every pane at the same keyed tree position", () => {
  const ui = useUI.getState();
  const first = ui.openCompose({ mode: "new" });
  const second = ui.openCompose({ mode: "reply", replyToMessageId: "message" });
  const desktop = element(composer());
  const desktopPanes = desktop.props.children as ReactElement<Record<string, unknown>>[];
  viewport.mobile = true;
  const mobile = element(composer());
  const mobilePanes = mobile.props.children as ReactElement<Record<string, unknown>>[];
  expect(mobile.type).toBe(desktop.type);
  expect(mobilePanes.map(pane => pane.key)).toEqual(desktopPanes.map(pane => pane.key));
  expect(mobilePanes).toHaveLength(2);
  expect(mobilePanes[0].key).toBe(first);
  expect(mobilePanes[0].props.className).toBe("hidden");
  expect(mobilePanes[1].key).toBe(second);
  for (let i = 0; i < desktopPanes.length; i++) {
    expect(element(mobilePanes[i].props.children).type).toBe(element(desktopPanes[i].props.children).type);
  }
});

test("Search dismisses the mailbox drawer before showing its own dialog", () => {
  useUI.setState({ sidebarOpen: true });
  useUI.getState().setPaletteOpen(true);
  expect(useUI.getState()).toMatchObject({ paletteOpen: true, sidebarOpen: false });
});
