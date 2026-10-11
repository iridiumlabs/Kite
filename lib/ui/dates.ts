import {
  format,
  isToday,
  isYesterday,
  isThisYear,
  differenceInCalendarDays,
} from "date-fns";

/**
 * Row dates: today -> "10:42 AM", yesterday -> "Yesterday", last 7 days ->
 * weekday ("Friday"), this year -> "Oct 9", older -> "Oct 9, 2025".
 * Used by both list layouts and collapsed reader rows.
 */
export function formatListDate(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEEE");
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

/** Expanded reader message date: "Today, 10:42 AM" / "Oct 9" / "Oct 9, 2025" */
export function formatMessageDate(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "'Today,' h:mm a");
  if (isYesterday(d)) return format(d, "'Yesterday,' h:mm a");
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

/**
 * Group headers in the two-column list: Today, Yesterday, Earlier this week,
 * Last week, then month names, then "Month Year" for previous years.
 */
export function dateGroupLabel(ts: number): string {
  const d = new Date(ts);
  const diff = differenceInCalendarDays(new Date(), d);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (diff < 7) return "Earlier this week";
  if (diff < 14) return "Last week";
  if (isThisYear(d)) return format(d, "MMMM");
  return format(d, "MMMM yyyy");
}

export function groupKey(ts: number): string {
  const label = dateGroupLabel(ts);
  if (
    label === "Today" ||
    label === "Yesterday" ||
    label === "Earlier this week" ||
    label === "Last week"
  ) {
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
