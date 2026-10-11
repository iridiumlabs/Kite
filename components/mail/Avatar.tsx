import { avatarColors, initials } from "@/lib/ui/avatars";
import clsx from "clsx";

export function Avatar({
  name,
  email,
  size = 28,
  self = false,
  rounded = "full",
  className,
}: {
  name: string;
  email?: string;
  size?: number;
  self?: boolean;
  rounded?: "full" | "md";
  className?: string;
}) {
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
      <div
        className="flex font-semibold"
        style={{ color: fg, fontSize, lineHeight: 1 }}
      >
        {initials(name)}
      </div>
    </div>
  );
}
