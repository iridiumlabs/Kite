"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

export type Appearance = "light" | "dark" | "system";

// Every user-facing theme control must update both the browser and the saved
// preference. Optimism keeps a route remount from restoring stale query data
// while the mutation is in flight. Initial hydration uses raw setTheme instead.
export function useAppearance() {
  const { theme, setTheme } = useTheme();
  const update = useMutation(api.settings.update).withOptimisticUpdate((store, args) => {
    const settings = store.getQuery(api.settings.get, {});
    if (settings !== undefined && args.theme !== undefined) {
      store.setQuery(api.settings.get, {}, { ...settings, theme: args.theme });
    }
  });
  const setAppearance = useCallback((appearance: Appearance) => {
    setTheme(appearance);
    void update({ theme: appearance }).catch(() => {
      toast.error("Could not save appearance. Try again.");
    });
  }, [setTheme, update]);
  return { theme, setAppearance };
}
