"use client";

import { useEffect, type ReactNode } from "react";
import { observeMotionInput } from "@/lib/ui/motionInput";

export function MotionPreferences({ children }: { children: ReactNode }) {
  // CSS reads the root attribute directly. Do not rerender the application
  // during pointer-down, before the control's click has been delivered.
  useEffect(() => observeMotionInput(window, () => {}), []);
  return children;
}
