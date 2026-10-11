"use client";

import { Suspense } from "react";
import { MailApp } from "@/components/containers/MailApp";

export default function MailPage() {
  return (
    <Suspense>
      <MailApp />
    </Suspense>
  );
}
