import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { UncertainSendResolution } from "../../components/compose/UncertainSendResolution";
import { Select } from "../../components/ui/Select";
import type { Id } from "../../convex/_generated/dataModel";

const h = vi.hoisted(() => ({ states: [] as unknown[], index: 0, resolve: vi.fn(), resolved: vi.fn(), attempts: [] as { sendLogId: string; messageIdHeader: string; createdAt: number; canConfirmDelivered: boolean; canConfirmNotDelivered: boolean }[] }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const i = h.index++;
    if (!(i in h.states)) h.states[i] = typeof initial === "function" ? initial() : initial;
    return [h.states[i], (v: unknown) => { h.states[i] = v; }];
  },
}));
vi.mock("convex/react", () => ({ useQuery: () => h.attempts, useMutation: () => h.resolve }));
function nodes(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...nodes(el.props.children)];
}
function render() { h.index = 0; return nodes(UncertainSendResolution({ draftId: "draft" as Id<"drafts">, onResolved: h.resolved })); }
function buttons() { return render().filter(n => n.type === "button") as ReactElement<{ disabled: boolean; onClick: () => void }>[]; }
function confirm() { const input = render().find(n => n.type === "input")!; (input.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } }); }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  h.states = []; h.index = 0; h.resolve.mockReset().mockResolvedValue({}); h.resolved.mockReset();
  h.attempts = [{ sendLogId: "log", messageIdHeader: "m@x", createdAt: 1, canConfirmDelivered: true, canConfirmNotDelivered: true }];
});

test.each(["delivered", "notDelivered"] as const)("resolution requires explicit confirmation and forwards %s without sending", async outcome => {
  expect(buttons().every(b => b.props.disabled)).toBe(true);
  buttons()[0].props.onClick(); await flush(); expect(h.resolve).not.toHaveBeenCalled();
  confirm(); expect(buttons().every(b => !b.props.disabled)).toBe(true);
  buttons()[outcome === "delivered" ? 0 : 1].props.onClick(); await flush();
  expect(h.resolve).toHaveBeenCalledWith({ draftId: "draft", sendLogId: "log", outcome, confirmed: true });
  expect(h.resolved).toHaveBeenCalledWith(outcome);
});

test("active attempts and known accepted delivery cannot be confirmed as non-delivery", async () => {
  h.attempts[0].canConfirmNotDelivered = false;
  confirm(); expect(buttons()[1].props.disabled).toBe(true);
  buttons()[1].props.onClick(); await flush(); expect(h.resolve).not.toHaveBeenCalled();
});

test("multiple legacy attempts require selection and changing it resets confirmation", async () => {
  h.attempts.push({ ...h.attempts[0], sendLogId: "second", messageIdHeader: "other@x" });
  confirm(); expect(buttons().every(b => b.props.disabled)).toBe(true);
  const select = render().find(n => n.type === Select)!;
  (select.props.onChange as (value: string) => void)("second");
  expect(buttons().every(b => b.props.disabled)).toBe(true);
  confirm(); buttons()[1].props.onClick(); await flush();
  expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ sendLogId: "second", confirmed: true }));
});

test("mutation failures keep the draft open and show an accessible error", async () => {
  h.resolve.mockRejectedValue(new Error("This send is still active"));
  confirm(); buttons()[0].props.onClick(); await flush();
  expect(h.resolved).not.toHaveBeenCalled();
  expect(render().find(n => n.props.role === "alert")!.props.children).toBe("This send is still active");
});
