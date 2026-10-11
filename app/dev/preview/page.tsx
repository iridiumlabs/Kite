import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PreviewApp } from "./PreviewApp";

export default function DevPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense>
      <PreviewApp />
    </Suspense>
  );
}
