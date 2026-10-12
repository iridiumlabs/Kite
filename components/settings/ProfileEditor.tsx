"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUser, type AppUser } from "@/components/providers";
import { Avatar } from "@/components/mail/Avatar";
import { prepareAvatar, profileNames } from "@/lib/ui/profile";

const inputCls = "w-full h-8 px-2.5 rounded-lg bg-search-field text-primary text-[13px]/4 outline-none placeholder:text-quaternary disabled:opacity-60";
const buttonCls = "pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-primary disabled:opacity-50";

export function ProfileEditor() {
  const user = useAppUser();
  return user ? <ProfileForm user={user} /> : null;
}

function ProfileForm({ user }: { user: AppUser }) {
  const [draft, setDraft] = useState<{ firstName: string; lastName: string } | null>(null);
  const [busy, setBusy] = useState<"name" | "photo" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const names = draft ?? { firstName: user.firstName, lastName: user.lastName };
  const changed = names.firstName.trim() !== user.firstName || names.lastName.trim() !== user.lastName;

  async function saveName() {
    if (busy) return;
    setBusy("name");
    try {
      const clean = profileNames(names.firstName, names.lastName);
      await user.updateName(clean.firstName, clean.lastName);
      setDraft(null);
      toast.success("Name updated");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update your name."); }
    finally { setBusy(null); }
  }
  async function updatePhoto(file: File | null) {
    if (busy) return;
    setBusy("photo");
    try {
      await user.updateImage(file ? await prepareAvatar(file) : null);
      toast.success(file ? "Photo updated" : "Photo removed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update your photo."); }
    finally { setBusy(null); }
  }

  return (
    <section aria-label="Profile" className="pb-4 mb-1 border-b border-divider">
      <h2 className="text-primary text-[13px]/4.5 font-semibold mb-3">Profile</h2>
      <div className="flex items-center gap-3">
        <div data-profile-photo><Avatar name={user.name} imageUrl={user.imageUrl} self size={48} rounded="md" /></div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonCls} disabled={!!busy} onClick={() => fileInput.current?.click()}>{busy === "photo" ? "Updating…" : user.imageUrl ? "Change photo" : "Upload photo"}</button>
            {user.imageUrl && <button type="button" className={buttonCls} disabled={!!busy} onClick={() => void updatePhoto(null)}>Remove photo</button>}
          </div>
        </div>
      </div>
      <input ref={fileInput} type="file" aria-label="Profile photo" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void updatePhoto(file);
      }} />
      <form className="mt-3" onSubmit={event => { event.preventDefault(); void saveName(); }}>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-secondary text-xs/4">First name<input autoComplete="given-name" className={`${inputCls} mt-1`} maxLength={100} required disabled={!!busy} value={names.firstName} onChange={event => setDraft({ ...names, firstName: event.target.value })} /></label>
          <label className="text-secondary text-xs/4">Last name<input autoComplete="family-name" className={`${inputCls} mt-1`} maxLength={100} disabled={!!busy} value={names.lastName} onChange={event => setDraft({ ...names, lastName: event.target.value })} /></label>
        </div>
        <div className="flex justify-end mt-3">
          <button type="submit" disabled={!!busy || !changed || !names.firstName.trim()} className="pressable shrink-0 h-7 px-3 rounded-md text-xs/4 font-semibold bg-accent text-white disabled:opacity-50">{busy === "name" ? "Saving…" : "Save name"}</button>
        </div>
      </form>
    </section>
  );
}
