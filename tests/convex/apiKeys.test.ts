import { expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { hashApiKey } from "../../convex/lib/apiKeyFormat";
import { makeT } from "./testUtil";

test("revoked keys disappear from the list but remain invalid for all auth paths", async () => {
  const t = makeT();
  const owner = t.withIdentity({ subject: "owner" });
  const other = t.withIdentity({ subject: "other" });
  const active = await owner.mutation(api.apiKeys.create, { name: "Active" });
  const revoked = await owner.mutation(api.apiKeys.create, { name: "Revoke me" });
  await other.mutation(api.apiKeys.create, { name: "Other user's key" });
  expect((await owner.query(api.apiKeys.list, {})).map(key => key._id)).toEqual([active.id, revoked.id]);
  await expect(other.mutation(api.apiKeys.revoke, { apiKeyId: revoked.id })).rejects.toThrow("API key not found");
  await owner.mutation(api.apiKeys.revoke, { apiKeyId: revoked.id });
  await owner.mutation(api.apiKeys.revoke, { apiKeyId: revoked.id });
  const keys = await owner.query(api.apiKeys.list, {});
  expect(keys.map(key => key._id)).toEqual([active.id]);
  expect(keys[0]).not.toHaveProperty("hash");
  expect(await t.query(api.apiKeys.whoami, { apiKey: revoked.key })).toBeNull();
  expect(await t.query(internal.apiKeys.resolveApiKey, { hash: await hashApiKey(revoked.key) })).toBeNull();
  expect(await t.query(api.apiKeys.whoami, { apiKey: active.key })).toMatchObject({ userId: "owner" });
  expect(await t.run(ctx => ctx.db.get(revoked.id))).toMatchObject({ revokedAt: expect.any(Number) });
  await t.run(ctx => ctx.db.patch(active.id, { revokedAt: 0 }));
  expect(await owner.query(api.apiKeys.list, {})).toEqual([]);
});
