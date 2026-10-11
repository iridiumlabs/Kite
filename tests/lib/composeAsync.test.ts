import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { Menu } from "@base-ui/react/menu";
import type { AccountInfo } from "../../lib/ui/types";
import { getFunctionName } from "convex/server";
import { ComposeLayer } from "../../components/containers/ComposeLayer";
import type { ComposeWindowProps } from "../../components/compose/ComposeWindow";

// A small hook harness exercises the real pane's async handlers without a DOM.
const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as unknown[][],
  stateIndex: 0, refIndex: 0, effectIndex: 0, pendingEffects: [] as (() => void)[],
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  content: vi.fn(), close: vi.fn(), error: vi.fn(), draft: undefined as unknown,
  editor: null as unknown, onEditorUpdate: undefined as ((html: string, text: string) => void) | undefined,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = h.stateIndex++;
    if (!(i in h.states)) h.states[i] = initial;
    return [h.states[i], (value: unknown) => { h.states[i] = typeof value === "function" ? value(h.states[i]) : value; }];
  },
  useRef: (initial: unknown) => {
    const i = h.refIndex++;
    return h.refs[i] ?? (h.refs[i] = { current: initial });
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void, deps: unknown[]) => {
    const i = h.effectIndex++;
    if (!h.effects[i] || deps.some((v, j) => v !== h.effects[i][j])) {
      h.effects[i] = deps;
      h.pendingEffects.push(fn);
    }
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "settings:get") return {};
    if (name === "drafts:get") return h.draft;
    if (name === "mail:getMessage") return {
      accountId: "account", subject: "Original", from: { email: "sender@x.com" }, to: [], cc: [], replyTo: [],
    };
    return [];
  },
  useAction: () => h.content,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => h.mutations.get(getFunctionName(ref)),
}));
vi.mock("../../components/compose/Editor", () => ({
  useComposeEditor: (opts: { onUpdate: typeof h.onEditorUpdate }) => { h.onEditorUpdate = opts.onUpdate; return h.editor; },
  ComposeEditorArea: () => null,
}));
vi.mock("../../lib/ui/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: h.error }) }));
vi.mock("../../lib/ui/store", () => ({ useUI: (selector?: (s: unknown) => unknown) => {
  const state = { compose: [win], setComposeDraft: vi.fn(), closeCompose: h.close };
  return selector ? selector(state) : state;
} }));

const win = { id: "window", mode: "forward", replyToMessageId: "message", expanded: false, minimized: false };
const accounts: AccountInfo[] = [
  { id: "account", email: "me@x.com", displayName: "Me", status: "ready", signatureHtml: "<p>Signature A</p>" },
  { id: "second", email: "second@x.com", status: "ready", signatureHtml: "<p>Signature B</p>" },
  { id: "no-signature", email: "none@x.com", status: "ready" },
];
const originalAttachment = { id: "a0", filename: "original.txt", contentType: "text/plain", size: 10 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
let pane: (props: unknown) => ReactElement;
let paneProps: unknown;
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  const element = pane(paneProps);
  for (const effect of h.pendingEffects.splice(0)) effect();
  return element;
}
function props() {
  return (render().props as { children: ReactElement[] }).children[0].props as ComposeWindowProps;
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  h.states = []; h.refs = []; h.effects = []; h.pendingEffects = [];
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  h.content.mockReset().mockReturnValue(new Promise(() => {})); h.close.mockReset(); h.error.mockReset(); h.draft = undefined;
  h.editor = null; h.onEditorUpdate = undefined;
  h.mutations.clear();
  for (const name of ["create", "update", "discard", "addAttachment", "removeAttachment", "generateUploadUrl", "scheduleSend", "cancelScheduledSend"])
    h.mutations.set(`drafts:${name}`, vi.fn().mockResolvedValue(name === "create" ? "draft" : name === "generateUploadUrl" ? "https://upload.test" : undefined));
  const layer = ComposeLayer({ accounts, categories: [] }) as ReactElement<{ children: ReactElement<{ children: ReactElement }>[] }>;
  const child = layer.props.children[0].props.children;
  pane = child.type as typeof pane; paneProps = child.props;
  render(); render();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function attach() {
  const input = (render().props as { children: ReactElement[] }).children[1];
  const onChange = (input.props as { onChange: (e: unknown) => void }).onChange;
  onChange({ target: { files: [new File(["upload"], "new.txt", { type: "text/plain" })], value: "new.txt" } });
}

test("forward loading cannot shift the upload completion target", async () => {
  const content = deferred<unknown>();
  h.content.mockReturnValue(content.promise);
  // Reset the mount so the forward effect uses this pending request.
  h.effects = []; h.refs = []; render(); render();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: "storage" }) }));
  attach();
  expect(h.mutations.get("drafts:create")).not.toHaveBeenCalled();
  content.resolve({ attachments: [originalAttachment] });
  await settle();
  expect(props().attachments).toMatchObject([{ filename: "original.txt" }, { filename: "new.txt", uploading: false }]);
  expect(h.mutations.get("drafts:addAttachment")).toHaveBeenCalledOnce();
});

test("a failed upload after forward loading removes only that upload", async () => {
  const content = deferred<unknown>(); h.content.mockReturnValue(content.promise);
  h.effects = []; h.refs = []; render(); render();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  attach(); content.resolve({ attachments: [originalAttachment] }); await settle();
  expect(props().attachments).toMatchObject([{ filename: "original.txt" }]);
  expect(h.error).toHaveBeenCalledWith("Could not attach new.txt");
});

test("discard cancels an autosave waiting for forwarded attachments", async () => {
  const content = deferred<unknown>(); h.content.mockReturnValue(content.promise);
  h.effects = []; h.refs = []; render(); render();
  const subject = props().subjectInput as ReactElement<{ onChange: (e: unknown) => void }>;
  subject.props.onChange({ target: { value: "Discard me" } });
  render(); await vi.advanceTimersByTimeAsync(800);
  props().onDiscard();
  expect(h.close).toHaveBeenCalledWith("window");
  content.resolve({ attachments: [originalAttachment] }); await settle();
  expect(h.mutations.get("drafts:create")).not.toHaveBeenCalled();
  expect(h.mutations.get("drafts:discard")).not.toHaveBeenCalled();
});

test("discard deletes a draft whose create mutation was already running", async () => {
  h.content.mockResolvedValue({ attachments: [originalAttachment] });
  h.effects = []; h.refs = []; render(); render(); await settle();
  const create = deferred<string>(); h.mutations.get("drafts:create")!.mockReturnValue(create.promise);
  props().onClose(); await settle();
  props().onDiscard(); create.resolve("late-draft"); await settle();
  expect(h.mutations.get("drafts:discard")).toHaveBeenCalledWith({ draftId: "late-draft" });
});

test("discard during a send's save cannot queue the discarded draft", async () => {
  h.content.mockResolvedValue({ attachments: [originalAttachment] });
  h.effects = []; h.refs = []; render(); render(); await settle();
  const create = deferred<string>(); h.mutations.get("drafts:create")!.mockReturnValue(create.promise);
  const toInput = props().toInput as ReactElement<{ onAdd: (chips: { email: string }[]) => void }>;
  toInput.props.onAdd([{ email: "to@x.com" }]);
  props().onSend(); await settle();
  props().onDiscard(); create.resolve("discarded-draft"); await settle();
  expect(h.mutations.get("drafts:scheduleSend")).not.toHaveBeenCalled();
  expect(h.mutations.get("drafts:discard")).toHaveBeenCalledWith({ draftId: "discarded-draft" });
});

function senderItems(node: unknown): ReactElement<{ onClick: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(senderItems);
  if (!isValidElement(node)) return [];
  if (node.type === Menu.Item) return [node as ReactElement<{ onClick: () => void }>];
  return senderItems((node.props as { children?: unknown }).children);
}

async function mountSignatureEditor() {
  let html = "<p></p>";
  const editor = {
    getHTML: () => html,
    getText: () => html.replace(/<[^>]*>/g, ""),
    commands: { setContent: vi.fn((value: string) => { html = value || "<p></p>"; }) },
  };
  h.editor = editor;
  h.content.mockResolvedValue({ attachments: [] });
  h.states = []; h.refs = []; h.effects = []; render(); render();
  await settle();
  return editor;
}

test("the sender menu replaces an untouched signature and saves the new sender's body", async () => {
  const editor = await mountSignatureEditor();
  expect(editor.getHTML()).toContain("Signature A");
  senderItems(props().fromLabel)[1].props.onClick(); render();
  expect(editor.getHTML()).toBe("<p></p><p>Signature B</p>");
  await vi.advanceTimersByTimeAsync(800);
  expect(h.mutations.get("drafts:create")).toHaveBeenCalledWith(expect.objectContaining({ accountId: "second", html: "<p></p><p>Signature B</p>", text: "Signature B" }));
});

test("switching to an account without a signature removes only the pristine signature", async () => {
  const editor = await mountSignatureEditor();
  senderItems(props().fromLabel)[2].props.onClick(); render();
  expect(editor.getText()).toBe("");
  // The parsed empty body is tracked too, so switching back can add a signature.
  senderItems(props().fromLabel)[1].props.onClick(); render();
  expect(editor.getText()).toBe("Signature B");
});

test("the sender menu preserves typed content rather than replacing the whole body", async () => {
  const editor = await mountSignatureEditor();
  editor.commands.setContent("<p>My writing</p><p>Signature A</p>");
  h.onEditorUpdate!(editor.getHTML(), editor.getText());
  senderItems(props().fromLabel)[1].props.onClick(); render();
  expect(editor.getHTML()).toBe("<p>My writing</p><p>Signature A</p>");
  await vi.advanceTimersByTimeAsync(800);
  expect(h.mutations.get("drafts:create")).toHaveBeenCalledWith(expect.objectContaining({ accountId: "second", html: editor.getHTML() }));
});
