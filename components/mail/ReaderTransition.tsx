"use client";

import { ViewTransition, type ReactNode } from "react";

const readerAnimation = { "mail-reader": "reader-crossfade", default: "none" };

/** Snapshot just the mail panes, keeping the sidebar and floating UI stationary. */
export function ReaderTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      name="mail-content"
      default="none"
      update={readerAnimation}
      share={readerAnimation}
      enter={readerAnimation}
      exit={readerAnimation}
    >
      <div className="flex grow basis-0 h-full min-w-0">{children}</div>
    </ViewTransition>
  );
}
