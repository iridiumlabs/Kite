"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function HomeGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoaded) return;
    router.replace(isSignedIn ? "/mail/primary" : "/sign-in");
  }, [isLoaded, isSignedIn, router]);
  return (
    <main className="flex h-dvh items-center justify-center bg-app">
      <div className="text-tertiary text-[13px]/4">Kite</div>
    </main>
  );
}
