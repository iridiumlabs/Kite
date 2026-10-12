"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { MailApp } from "@/components/containers/MailApp";
import { DEV_AUTH } from "@/components/providers";

export default function MailPage() {
  return (
    <Suspense>
      <Authenticated><MailApp /></Authenticated>
      <AuthLoading>
        <main className="flex h-dvh items-center justify-center bg-app" role="status">
          <span className="text-tertiary text-[13px]/4">Loading your mail…</span>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <main className="flex h-dvh flex-col gap-3 items-center justify-center bg-app">
          <span className="text-secondary text-[13px]/4">{DEV_AUTH ? "Development authentication could not be completed." : "Sign in to open your mail."}</span>
          {DEV_AUTH ? <button className="pressable text-accent" onClick={() => window.location.reload()}>Retry</button> : <Link className="text-accent" href="/sign-in">Sign in</Link>}
        </main>
      </Unauthenticated>
    </Suspense>
  );
}
