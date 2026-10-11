const PALETTE: [string, string][] = [
  ["#F2E4D6", "#8F5428"],
  ["#DCE8F7", "#2F5D8C"],
  ["#E4F2E5", "#2E7D3C"],
  ["#F3E1F6", "#8A3D95"],
  ["#FBE3E4", "#A63440"],
  ["#E0F4F3", "#1F6E68"],
  ["#FDF3D8", "#8A6A1C"],
  ["#E3E3E8", "#48484A"],
];

export function senderDisplay(addr: { name?: string; email: string }): string {
  const n = addr.name?.trim();
  return n && n.length > 0 ? n : addr.email;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColors(key: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const [bg, fg] = PALETTE[Math.abs(h) % PALETTE.length];
  return { bg, fg };
}
