"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

export function SignOutListener() {
  const { signOut } = useAuth();
  useEffect(() => {
    const fn = () => void signOut();
    window.addEventListener("kite:signout", fn);
    return () => window.removeEventListener("kite:signout", fn);
  }, [signOut]);
  return null;
}
