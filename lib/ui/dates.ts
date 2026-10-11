import {
  format,
  isToday,
  isYesterday,
  isThisWeek,
  isThisYear,
  differenceInCalendarDays,
} from "date-fns";

/** Right-column date in list rows: "10:42 AM" / "Yesterday" / "Friday" / "Oct 9" */
export function formatListDate(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (isThisWeek(d)) return format(d, "EEEE");
  return format(d, "MMM d");
}

/** Compact row date: same but without "Yesterday" expansion */
export function formatCompactDate(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEEE");
  return format(d, "MMM d");
}

/** Reader collapsed message date: "Oct 9" */
export function formatMessageDate(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "'Today,' h:mm a");
  if (isYesterday(d)) return format(d, "'Yesterday,' h:mm a");
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

/** Section headers in the wide list: Today / Yesterday / Earlier this week / month */
export function dateGroupLabel(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (differenceInCalendarDays(new Date(), d) < 6) return "Earlier this week";
  return format(d, "MMMM");
}

export function groupKey(ts: number): string {
  const label = dateGroupLabel(ts);
  if (label === "Today" || label === "Yesterday" || label === "Earlier this week") {
    return label;
  }
  return format(new Date(ts), "yyyy-MM");
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) {
    const kb = size / 1024;
    return `${kb < 10 ? Math.round(kb * 10) / 10 : Math.round(kb)} KB`;
  }
  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
}
