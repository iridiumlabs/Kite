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
  useSyncExternalStore,
} from "react";
import { avatarDataUrl, clerkProfileActions, DEFAULT_DEV_PROFILE, DEV_PROFILE_EVENT, DEV_PROFILE_KEY, profileNames, readDevProfile, validateAvatar, type ProfileFields } from "@/lib/ui/profile";

export const DEV_AUTH = process.env.NEXT_PUBLIC_KITE_DEV_AUTH === "1";

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
  firstName: string;
  lastName: string;
  updateName: (firstName: string, lastName: string) => Promise<void>;
  updateImage: (file: File | null) => Promise<void>;
}

function useClerkAppUser(): AppUser | undefined {
  const { user } = useUser();
  if (!user) return undefined;
  const name = user.fullName || user.primaryEmailAddress?.emailAddress || "Account";
  return {
    name,
    initial: name.slice(0, 1).toUpperCase(),
    imageUrl: user.hasImage ? user.imageUrl : undefined,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    ...clerkProfileActions(user),
  };
}

const DEV_PROFILE_JSON = JSON.stringify(DEFAULT_DEV_PROFILE);
function devSnapshot() {
  try { return localStorage.getItem(DEV_PROFILE_KEY) ?? DEV_PROFILE_JSON; }
  catch { return DEV_PROFILE_JSON; }
}
function subscribeDevProfile(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(DEV_PROFILE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DEV_PROFILE_EVENT, onChange);
  };
}
function saveDevProfile(patch: Partial<ProfileFields>) {
  localStorage.setItem(DEV_PROFILE_KEY, JSON.stringify({ ...readDevProfile(devSnapshot()), ...patch }));
  window.dispatchEvent(new Event(DEV_PROFILE_EVENT));
}
function useDevAppUser(): AppUser {
  const raw = useSyncExternalStore(subscribeDevProfile, devSnapshot, () => DEV_PROFILE_JSON);
  const profile = readDevProfile(raw);
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  return {
    ...profile, name, initial: name[0].toUpperCase(), isDev: true,
    updateName: async (firstName, lastName) => { saveDevProfile(profileNames(firstName, lastName)); },
    updateImage: async file => {
      if (file) validateAvatar(file);
      saveDevProfile({ imageUrl: file ? await avatarDataUrl(file) : undefined });
    },
  };
}

// The auth mode is fixed at build time, not a conditional hook at render time.
export const useAppUser = DEV_AUTH ? useDevAppUser : useClerkAppUser;

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
