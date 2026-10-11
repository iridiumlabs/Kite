"use client";

import { useState } from "react";
import { avatarColors, initials } from "@/lib/ui/avatars";
import clsx from "clsx";

export function Avatar({
  name,
  email,
  imageUrl,
  size = 28,
  self = false,
  rounded = "full",
  className,
}: {
  name: string;
  email?: string;
  imageUrl?: string;
  size?: number;
  self?: boolean;
  rounded?: "full" | "md";
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const { bg, fg } = self
    ? { bg: "var(--avatar)", fg: "#ffffff" }
    : avatarColors(email ?? name);
  const fontSize = size >= 36 ? 13 : size >= 22 ? 11 : 9;
  return (
    <div
      className={clsx("flex items-center justify-center shrink-0", className)}
      style={{
        width: size,
        height: size,
        borderRadius: rounded === "full" ? size / 2 : 6,
        background: bg,
      }}
    >
      {imageUrl && imageUrl !== failedUrl ? (
        // Clerk-hosted or validated local dev avatar, not an optimized Next image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="size-full object-cover" style={{ borderRadius: "inherit" }} onError={() => setFailedUrl(imageUrl)} />
      ) : (
        <div className="flex font-semibold" style={{ color: fg, fontSize, lineHeight: 1 }}>
          {initials(name)}
        </div>
      )}
    </div>
  );
}
