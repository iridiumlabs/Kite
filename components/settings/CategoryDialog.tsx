"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { toast } from "sonner";
import type { CategoryInfo } from "@/lib/ui/types";

const PALETTE = [
  "#FF3B30",
  "#FF9F0A",
  "#FFCC00",
  "#34C759",
  "#00C7BE",
  "#007AFF",
  "#5856D6",
  "#AF52DE",
  "#FF2D55",
  "#8E8E93",
];

const inputCls =
  "w-full h-9 px-2.5 rounded-lg bg-search-field text-primary text-[13px]/4 outline-none placeholder:text-quaternary";

export function CategoryDialog({
  mode,
  category,
  onClose,
}: {
  mode: "create" | "edit";
  category?: CategoryInfo;
  onClose: () => void;
}) {
  const create = useMutation(api.categories.create);
  const update = useMutation(api.categories.update);
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [color, setColor] = useState(category?.color ?? PALETTE[5]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (mode === "create") {
        await create({ name: name.trim(), description, color });
        toast(`Category "${name.trim()}" created`);
      } else if (category) {
        await update({
          categoryId: category.id as Id<"categories">,
          name: name.trim(),
          description,
          color,
        });
        toast("Category updated");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o: boolean) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-[60] bg-black/25" />
        <Dialog.Popup className="dialog-popup fixed left-1/2 top-1/2 z-[61] w-100 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-menu p-5 menu-shadow ring-1 ring-menu-ring">
          <Dialog.Title className="font-semibold text-primary text-[15px]/5">
            {mode === "create" ? "New category" : "Edit category"}
          </Dialog.Title>
          <div className="flex flex-col gap-3 mt-4">
            <input
              className={inputCls}
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <textarea
              className="w-full h-20 px-2.5 py-2 rounded-lg bg-search-field text-primary text-[13px]/4.5 outline-none placeholder:text-quaternary resize-none"
              placeholder="Describe which emails belong here. Applies to new mail only."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex items-center gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className="size-6 rounded-md transition-transform"
                  style={{
                    background: c,
                    outline:
                      color === c ? "2px solid var(--accent)" : undefined,
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="pressable h-8 px-3 rounded-lg text-primary text-[13px]/4 font-medium bg-search-field"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              className="pressable h-8 px-3 rounded-lg bg-accent text-white font-semibold text-[13px]/4 disabled:opacity-50"
            >
              {mode === "create" ? "Create" : "Save"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
