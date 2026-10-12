import { expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { SettingsHost } from "../../components/containers/SettingsHost";

const h = vi.hoisted(() => ({ states: [] as unknown[], index: 0, update: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
}));
vi.mock("convex/react", () => ({ useMutation: () => h.update, useAction: () => vi.fn(), useQuery: () => undefined }));
vi.mock("../../lib/ui/store", () => ({ useUI: (selector?: (state: unknown) => unknown) => {
  const state = { settingsOpen: true, settingsTab: "connections" };
  return selector ? selector(state) : state;
} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("../../components/settings/ProfileEditor", () => ({ ProfileEditor: () => null }));
vi.mock("../../lib/ui/useAppearance", () => ({ useAppearance: () => ({}) }));

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: unknown }>(node)) return [];
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)];
}

test("editing preloads the configured signature and clearing saves an explicit empty string", async () => {
  h.states = []; h.index = 0; h.update.mockReset().mockResolvedValue(undefined);
  const host = SettingsHost({ categories: [], accounts: [{ id: "account", email: "me@x", status: "ready", signatureHtml: "Old signature" }], onConnectAccount: vi.fn() });
  const tab = elements(host).find(e => typeof e.type === "function" && e.type.name === "ConnectionsTab")!;
  const render = () => { h.index = 0; return elements((tab.type as (props: unknown) => ReactElement)(tab.props)); };
  const button = (label: string) => render().find(e => e.type === "button" && e.props.children === label)!;
  (button("Edit").props.onClick as () => void)();
  const signature = render().find(e => e.props.placeholder === "Signature (HTML allowed)")!;
  expect(signature.props.value).toBe("Old signature");
  (signature.props.onChange as (event: unknown) => void)({ target: { value: "" } });
  (button("Save").props.onClick as () => void)();
  await Promise.resolve(); await Promise.resolve();
  expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account", signatureHtml: "" }));
});
