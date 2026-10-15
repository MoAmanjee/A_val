/**
 * Meta rejects an interactive message outright when any field is over length,
 * which would silently break the ordering flow. These are the Cloud API limits;
 * message builders chunk against them and the driver truncates as a last guard.
 */
export const WA_LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  headerText: 60,
  footerText: 60,
  buttonTitle: 20,
  /** CTA URL button label (Order online). */
  ctaUrlButton: 20,
  maxButtons: 3,
  listButtonLabel: 20,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  /** Total rows across every section of one list message. */
  maxListRows: 10,
  maxListSections: 10,
  replyId: 256,
} as const;

export function clamp(value: string, max: number): string {
  const v = value.trim();
  if (v.length <= max) return v;
  if (max <= 1) return v.slice(0, max);
  const budget = max - 1;
  let cut = v.slice(0, budget);
  // Break on a space or a new line so a row does not end in the middle of a word.
  const breakAt = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  if (breakAt > Math.floor(budget * 0.6)) cut = cut.slice(0, breakAt);
  return `${cut.trimEnd()}\u2026`;
}

/** Splits rows into list-sized pages so a long category still fits. */
export function pageRows<T>(rows: T[], perPage = WA_LIMITS.maxListRows): T[][] {
  if (rows.length === 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  return pages;
}
