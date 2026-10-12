import { beforeEach, expect, test, vi } from "vitest";
import { SendFailureNotifications } from "../../components/containers/SendFailureNotifications";
import { draftSendProblem } from "../../lib/ui/draftSendProblem";

const h = vi.hoisted(() => ({
  seen: new Map<string, string>(), problems: [] as { draftId: string; status: string; sendError?: string; subject: string; updatedAt: number }[],
  error: vi.fn(), dismiss: vi.fn(), open: vi.fn(),
}));
vi.mock("react", () => ({ useRef: () => ({ current: h.seen }), useEffect: (fn: () => void) => fn() }));
vi.mock("convex/react", () => ({ useQuery: () => h.problems }));
vi.mock("sonner", () => ({ toast: { error: h.error, dismiss: h.dismiss } }));
vi.mock("../../lib/ui/store", () => ({ useUI: { getState: () => ({ openCompose: h.open }) } }));
beforeEach(() => {
  h.seen.clear(); h.problems = []; h.error.mockReset(); h.dismiss.mockReset(); h.open.mockReset();
});

test("background failures notify outside Drafts, link to the failed draft, and deduplicate rerenders", () => {
  SendFailureNotifications();
  h.problems = [{ draftId: "draft", status: "failed", sendError: "550 Rejected", subject: "Hello", updatedAt: 1 }];
  SendFailureNotifications(); SendFailureNotifications();
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenCalledWith("Send failed: 550 Rejected", expect.objectContaining({ description: "Hello", duration: Infinity }));
  h.error.mock.calls[0][1].action.onClick();
  expect(h.open).toHaveBeenCalledWith({ mode: "draft", draftId: "draft" });
  h.problems = []; SendFailureNotifications();
  expect(h.dismiss).toHaveBeenCalledWith("send-problem-draft");
});

test("a later failed attempt updates the notification; ambiguous delivery warns against retrying", () => {
  h.problems = [{ draftId: "draft", status: "failed", sendError: "Connection timeout", subject: "", updatedAt: 1 }];
  SendFailureNotifications();
  h.problems = [{ ...h.problems[0], status: "uncertain", sendError: "Socket timeout", updatedAt: 2 }];
  SendFailureNotifications();
  expect(h.error).toHaveBeenLastCalledWith("Delivery is uncertain. Check Sent before sending again.", expect.objectContaining({ id: "send-problem-draft" }));
});

test("draft list and reopened composer use explicit failure text, not a stale error after retry", () => {
  expect(draftSendProblem({ status: "failed", sendError: "Missing attachment" })).toBe("Send failed: Missing attachment");
  expect(draftSendProblem({ status: "uncertain" })).toContain("Check Sent");
  expect(draftSendProblem({ status: "scheduled", sendError: "old rejection" })).toBeUndefined();
  expect(draftSendProblem({ status: "sending" })).toBeUndefined();
});
