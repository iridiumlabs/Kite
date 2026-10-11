"use client";

import { ClerkProvider, useAuth, useUser } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexProviderWithAuth } from "convex/react";
import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const DEV_AUTH = process.env.NEXT_PUBLIC_POST_DEV_AUTH === "1";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
);

function useDevAuth() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const expiryRef = useRef(0);

  const fetchToken = useCallback(async () => {
    const res = await fetch("/api/dev-auth/token");
    if (!res.ok) throw new Error("Dev auth token unavailable");
    const { token } = (await res.json()) as { token: string };
    tokenRef.current = token;
    expiryRef.current = Date.now() + 50 * 60 * 1000;
    setIsAuthenticated(true);
    return token;
  }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchToken()
        .catch(() => {})
        .finally(() => {
          if (alive) setIsLoading(false);
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fetchToken]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (
        !forceRefreshToken &&
        tokenRef.current &&
        Date.now() < expiryRef.current
      ) {
        return tokenRef.current;
      }
      return fetchToken();
    },
    [fetchToken],
  );

  return {
    isLoading,
    isAuthenticated,
    fetchAccessToken,
  };
}

export interface AppUser {
  name: string;
  initial: string;
  imageUrl?: string;
  isDev?: boolean;
}

export function useAppUser(): AppUser | undefined {
  if (DEV_AUTH) {
    return { name: "Dev user", initial: "D", isDev: true };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user } = useUser();
  if (!user) return undefined;
  const name =
    user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "Account";
  return {
    name,
    initial: name.slice(0, 1).toUpperCase(),
    imageUrl: user.imageUrl ?? undefined,
  };
}

export function Providers({ children }: { children: ReactNode }) {
  if (DEV_AUTH) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useDevAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
