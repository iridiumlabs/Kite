import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { makeT, seedAccount } from "./testUtil";

test("First account selection clears the saved sender without changing preferences", async () => {
  const t = makeT();
  const user = t.withIdentity({ subject: "settings-user" });
  const accountId = await seedAccount(t, "settings-user");
  await user.mutation(api.settings.update, { defaultAccountId: accountId, theme: "dark", undoSendSeconds: 10 });
  expect(await user.query(api.settings.get, {})).toMatchObject({ defaultAccountId: accountId });
  await user.mutation(api.settings.update, { defaultAccountId: null });
  const settings = await user.query(api.settings.get, {});
  expect(settings).not.toHaveProperty("defaultAccountId");
  expect(settings).toMatchObject({ theme: "dark", undoSendSeconds: 10, loadRemoteImages: false });
});

test("clearing a default is safe without an existing settings document", async () => {
  const user = makeT().withIdentity({ subject: "settings-user" });
  await user.mutation(api.settings.update, { defaultAccountId: null });
  expect(await user.query(api.settings.get, {})).toMatchObject({ theme: "system" });
});

test("default sender selection cannot reference another user's mailbox", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "someone-else");
  await expect(t.withIdentity({ subject: "settings-user" }).mutation(api.settings.update, { defaultAccountId: accountId })).rejects.toThrow("Account not found");
});
