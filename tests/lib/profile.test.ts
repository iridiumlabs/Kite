import { expect, test, vi } from "vitest";
import { clerkProfileActions, DEFAULT_DEV_PROFILE, MAX_AVATAR_BYTES, profileNames, readDevProfile, validateAvatar } from "../../lib/ui/profile";

test("profile names are trimmed and the last name is optional", () => {
  expect(profileNames("  Maya  ", "  Chen ")).toEqual({ firstName: "Maya", lastName: "Chen" });
  expect(profileNames("Maya", "")).toEqual({ firstName: "Maya", lastName: "" });
  expect(() => profileNames("  ", "Chen")).toThrow("Enter a first name");
  expect(() => profileNames("a".repeat(101), "")).toThrow("100 characters");
});

test.each(["image/png", "image/jpeg", "image/webp"])("avatar allows %s", type => {
  expect(() => validateAvatar({ type, size: MAX_AVATAR_BYTES })).not.toThrow();
});

test("avatar rejects SVG, non-images, empty and oversized files", () => {
  for (const type of ["image/svg+xml", "text/html", "application/pdf", ""]) expect(() => validateAvatar({ type, size: 100 })).toThrow("PNG, JPEG or WebP");
  for (const size of [0, MAX_AVATAR_BYTES + 1]) expect(() => validateAvatar({ type: "image/png", size })).toThrow("2 MB");
});

test("dev profile parsing rejects broken data and unsafe image URLs", () => {
  for (const raw of [null, "{", "null", JSON.stringify({ firstName: "", lastName: "" }), "x".repeat(500_001)]) expect(readDevProfile(raw)).toEqual(DEFAULT_DEV_PROFILE);
  const fields = { firstName: "Maya", lastName: "Chen" };
  for (const imageUrl of ["javascript:alert(1)", "https://tracking.test/pixel", "data:image/svg+xml;base64,PHN2Zz4="]) expect(readDevProfile(JSON.stringify({ ...fields, imageUrl })).imageUrl).toBeUndefined();
  expect(readDevProfile(JSON.stringify({ ...fields, imageUrl: "data:image/png;base64,YQ==" })).imageUrl).toBe("data:image/png;base64,YQ==");
});

test("production name and avatar actions call the authenticated Clerk resource", async () => {
  const user = { update: vi.fn().mockResolvedValue({}), setProfileImage: vi.fn().mockResolvedValue({}), reload: vi.fn().mockResolvedValue({}) };
  const actions = clerkProfileActions(user);
  await actions.updateName(" Maya ", " Chen ");
  expect(user.update).toHaveBeenCalledWith({ firstName: "Maya", lastName: "Chen" });
  const file = new File(["test"], "photo.png", { type: "image/png" });
  await actions.updateImage(file);
  expect(user.setProfileImage).toHaveBeenLastCalledWith({ file });
  await actions.updateImage(null);
  expect(user.setProfileImage).toHaveBeenLastCalledWith({ file: null });
  await expect(actions.updateName("", "Chen")).rejects.toThrow();
  await expect(actions.updateImage(new File(["test"], "bad.svg", { type: "image/svg+xml" }))).rejects.toThrow();
  expect(user.update).toHaveBeenCalledTimes(1);
  expect(user.setProfileImage).toHaveBeenCalledTimes(2);
  expect(user.reload).toHaveBeenCalledTimes(2);
});

test("Clerk persistence failures propagate to the profile UI", async () => {
  const failure = new Error("Profile changes are disabled");
  const actions = clerkProfileActions({ update: vi.fn().mockRejectedValue(failure), setProfileImage: vi.fn().mockRejectedValue(failure), reload: vi.fn() });
  await expect(actions.updateName("Maya", "Chen")).rejects.toThrow(failure);
  await expect(actions.updateImage(null)).rejects.toThrow(failure);
});
