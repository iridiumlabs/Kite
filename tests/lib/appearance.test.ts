import { beforeEach, expect, test, vi } from "vitest";
import { useAppearance } from "../../lib/ui/useAppearance";

const mocks = vi.hoisted(() => {
  const update = vi.fn();
  const optimistic = vi.fn<(callback: unknown) => typeof update>(() => update);
  return { update, optimistic, setTheme: vi.fn(), error: vi.fn() };
});
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: mocks.setTheme }) }));
vi.mock("convex/react", () => ({ useMutation: () => ({ withOptimisticUpdate: mocks.optimistic }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue(undefined);
});

test.each(["light", "dark", "system"] as const)("appearance controls persist %s as well as applying it locally", appearance => {
  useAppearance().setAppearance(appearance);
  expect(mocks.setTheme).toHaveBeenCalledWith(appearance);
  expect(mocks.update).toHaveBeenCalledWith({ theme: appearance });
});

test("optimistic settings preserve other preferences during immediate navigation", () => {
  useAppearance();
  const callback = mocks.optimistic.mock.calls[0][0];
  if (typeof callback !== "function") throw new Error("Missing optimistic update");
  const settings = { userId: "test", theme: "light", undoSendSeconds: 10, loadRemoteImages: false };
  const store = { getQuery: vi.fn(() => settings), setQuery: vi.fn<(query: unknown, args: unknown, value: unknown) => void>() };
  callback(store, { theme: "dark" });
  expect(store.setQuery.mock.calls[0][2]).toEqual({ ...settings, theme: "dark" });
});

test("optimistic settings do not fabricate an unloaded query", () => {
  useAppearance();
  const callback = mocks.optimistic.mock.calls[0][0];
  if (typeof callback !== "function") throw new Error("Missing optimistic update");
  const store = { getQuery: vi.fn(() => undefined), setQuery: vi.fn() };
  callback(store, { theme: "dark" });
  expect(store.setQuery).not.toHaveBeenCalled();
});

test("failed persistence is reported rather than silently discarded", async () => {
  mocks.update.mockRejectedValue(new Error("Offline"));
  useAppearance().setAppearance("dark");
  await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not save appearance. Try again."));
});
