export interface ProfileFields {
  firstName: string;
  lastName: string;
  imageUrl?: string;
}

export const DEV_PROFILE_KEY = "kite.dev-profile";
export const DEV_PROFILE_EVENT = "kite:dev-profile";
export const DEFAULT_DEV_PROFILE: ProfileFields = { firstName: "Dev", lastName: "user" };
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function profileNames(firstName: string, lastName: string) {
  const names = { firstName: firstName.trim(), lastName: lastName.trim() };
  if (!names.firstName) throw new Error("Enter a first name.");
  if (names.firstName.length > 100 || names.lastName.length > 100) {
    throw new Error("Names must be 100 characters or fewer.");
  }
  return names;
}

// Production identity writes stay with Clerk, never in the mail database.
export function clerkProfileActions(user: {
  update: (names: { firstName: string; lastName: string }) => Promise<unknown>;
  setProfileImage: (params: { file: File | null }) => Promise<unknown>;
  reload: () => Promise<unknown>;
}) {
  return {
    updateName: async (firstName: string, lastName: string) => {
      await user.update(profileNames(firstName, lastName));
    },
    updateImage: async (file: File | null) => {
      if (file) validateAvatar(file);
      await user.setProfileImage({ file });
      await user.reload();
    },
  };
}

export function validateAvatar(file: Pick<File, "type" | "size">) {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (!file.size || file.size > MAX_AVATAR_BYTES) throw new Error("Choose an image under 2 MB.");
}

export function readDevProfile(raw: string | null): ProfileFields {
  try {
    if (!raw || raw.length > 500_000) return DEFAULT_DEV_PROFILE;
    const value = JSON.parse(raw);
    if (typeof value?.firstName !== "string" || typeof value?.lastName !== "string") return DEFAULT_DEV_PROFILE;
    const names = profileNames(value.firstName, value.lastName);
    const imageUrl = typeof value.imageUrl === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.imageUrl)
      ? value.imageUrl : undefined;
    return { ...names, imageUrl };
  } catch { return DEFAULT_DEV_PROFILE; }
}

// Normalize to a small, square raster before upload. No SVG or remote URLs.
export async function prepareAvatar(file: File): Promise<File> {
  validateAvatar(file);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("This image could not be opened. Choose another photo."); }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("This image is too large. Choose a smaller photo.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the photo.");
    const edge = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 256, 256);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not prepare the photo.")), "image/png"));
    return new File([blob], "profile.png", { type: "image/png" });
  } finally { bitmap.close(); }
}

export function avatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the photo."));
    reader.onerror = () => reject(new Error("Could not read the photo."));
    reader.readAsDataURL(file);
  });
}
