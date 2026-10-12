"use client";

import type { AttachmentInfo } from "@/lib/ui/types";
import { formatBytes } from "@/lib/ui/dates";

const TYPE_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  pdf: { bg: "#FFEDEB", fg: "#D93A2B", label: "PDF" },
  image: { bg: "#E4F2E5", fg: "#2E7D3C", label: "IMG" },
  zip: { bg: "#E3E3E8", fg: "#48484A", label: "ZIP" },
  doc: { bg: "#DCE8F7", fg: "#2F5D8C", label: "DOC" },
  sheet: { bg: "#E4F2E5", fg: "#2E7D3C", label: "XLS" },
  file: { bg: "#E3E3E8", fg: "#48484A", label: "FILE" },
};

function kind(att: AttachmentInfo) {
  const t = att.contentType.toLowerCase();
  const name = att.filename.toLowerCase();
  if (t === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (t.startsWith("image/")) return "image";
  if (t.includes("zip") || name.endsWith(".zip")) return "zip";
  if (t.includes("word") || name.endsWith(".doc") || name.endsWith(".docx"))
    return "doc";
  if (
    t.includes("sheet") ||
    t.includes("excel") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".csv")
  )
    return "sheet";
  return "file";
}

export function AttachmentCard({
  attachment,
  onDownload,
}: {
  attachment: AttachmentInfo;
  onDownload?: (a: AttachmentInfo) => void;
}) {
  const k = TYPE_COLORS[kind(attachment)];
  return (
    <button
      onClick={() => onDownload?.(attachment)}
      className="mail-row flex items-center h-11 pr-3.5 pl-2.5 rounded-[10px] gap-2.5 border border-border-card w-max max-w-full text-left pressable"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="flex items-center justify-center w-6.5 h-7.5 rounded-sm shrink-0"
        style={{ background: k.bg }}
      >
        <div
          className="tracking-[0.02em] font-bold text-[8px]/2.5"
          style={{ color: k.fg }}
        >
          {k.label}
        </div>
      </div>
      <div className="flex flex-col gap-px min-w-0">
        <div className="font-medium text-primary text-xs/4 line-clamp-1">
          {attachment.filename}
        </div>
        <div className="tnum text-tertiary text-[11px]/3.5">
          {formatBytes(attachment.size)}
        </div>
      </div>
    </button>
  );
}
