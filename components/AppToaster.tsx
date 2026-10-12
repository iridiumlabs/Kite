"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      toastOptions={{
        style: {
          borderRadius: "10px",
          boxShadow: "var(--shadow-menu)",
          border: "none",
        },
      }}
    />
  );
}
