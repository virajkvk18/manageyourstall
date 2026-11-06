// Shared limits, validators and input cleaning for the MYS backend (ARCHITECTURE.md §17.3). created by viraj
import { ConvexError, v } from "convex/values";

export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_TEXT = 60;
export const LOCK_AFTER = 5;
export const LOCK_BASE_MS = 60 * 1000;
export const LOCK_MAX_MS = 60 * 60 * 1000;
/** Failure counters older than this start again from zero. */
export const ATTEMPT_RESET_MS = 24 * 60 * 60 * 1000;
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const LOGIN_ID_RE = /^[a-z0-9._@+-]+$/;

/** Optional text field that also tolerates null (treated as ''). */
const optText = v.optional(v.union(v.string(), v.null()));

/** Stall info as sent by clients; every field optional (create requires a name). */
export const stallInfoValidator = v.object({
  name: optText,
  booth: optText,
  themeId: optText,
  accent: optText,
  heroArt: v.optional(v.union(v.array(v.string()), v.null())),
  eventName: optText,
  city: optText,
});

export const summaryValidator = v.object({
  orders: v.number(),
  collected: v.number(),
  bills: v.number(),
});

export type StallInfoInput = {
  name?: string | null;
  booth?: string | null;
  themeId?: string | null;
  accent?: string | null;
  heroArt?: string[] | null;
  eventName?: string | null;
  city?: string | null;
};

export type StallInfo = {
  name: string;
  booth: string;
  themeId: string;
  accent: string;
  heroArt: string[];
  eventName: string;
  city: string;
};

export function fail(message: string): never {
  throw new ConvexError(message);
}

/** Normalize a login ID: trimmed and lowercased. */
export function normalizeLoginId(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Validate and normalize a login ID (3–60 chars, letters/digits/._@+-). */
export function checkLoginId(raw: string): string {
  const id = normalizeLoginId(raw);
  if (!id) fail("Enter your login ID.");
  if (id.length < 3) fail("Login ID needs at least 3 characters.");
  if (id.length > 60) fail("Login ID can be at most 60 characters.");
  if (!LOGIN_ID_RE.test(id)) fail("Login ID can use letters, numbers and . _ @ + - only (no spaces).");
  return id;
}

/** Validate a password (6–100 chars). */
export function checkPassword(pw: string, label = "Password"): string {
  if (typeof pw !== "string" || pw.length === 0) fail(`Enter a ${label.toLowerCase()}.`);
  if (pw.length < 6) fail(`${label} needs at least 6 characters.`);
  if (pw.length > 100) fail(`${label} can be at most 100 characters.`);
  return pw;
}

/** Trim and clip free text (device labels etc.) — never throws. */
export function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Trim text and refuse it when longer than max. */
export function cleanText(value: unknown, label: string, max = MAX_TEXT): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length > max) fail(`${label} can be at most ${max} characters.`);
  return s;
}

/** A person's display name (≤ 60 chars). */
export function cleanName(value: unknown, fallback: string): string {
  const s = cleanText(value, "Name");
  return s || fallback;
}

/**
 * Clean stall info. Returns only the fields that were sent (for patches); with requireName the name must be present.
 */
export function cleanInfo(info: StallInfoInput | undefined | null, requireName: boolean): Partial<StallInfo> {
  const out: Partial<StallInfo> = {};
  const src = info ?? {};
  if (src.name !== undefined || requireName) {
    const name = cleanText(src.name, "Stall name");
    if (!name) fail("Give your stall a name.");
    out.name = name;
  }
  if (src.booth !== undefined) out.booth = cleanText(src.booth, "Stall number");
  if (src.themeId !== undefined) out.themeId = cleanText(src.themeId, "Theme");
  if (src.accent !== undefined) out.accent = cleanText(src.accent, "Accent colour");
  if (src.eventName !== undefined) out.eventName = cleanText(src.eventName, "Event name");
  if (src.city !== undefined) out.city = cleanText(src.city, "City");
  if (src.heroArt !== undefined) {
    const art = src.heroArt ?? [];
    if (art.length > 12) fail("Pick at most 12 hero pictures.");
    out.heroArt = art.map(a => cleanText(a, "Hero picture id", 100)).filter(Boolean);
  }
  return out;
}

/** Summary numbers must be finite and non-negative. */
export function cleanSummary(s: { orders: number; collected: number; bills: number }) {
  for (const key of ["orders", "collected", "bills"] as const) {
    const n = s[key];
    if (!Number.isFinite(n) || n < 0 || n > 1e15) fail("Stall summary numbers look wrong. Please try again.");
  }
  return { orders: s.orders, collected: s.collected, bills: s.bills };
}

/** Normalize a typed stall code to 'MYS-XXXXX' or null when it can't be one. */
export function normalizeCode(raw: string): string | null {
  let s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 8 && s.startsWith("MYS")) s = s.slice(3);
  if (s.length !== 5) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return `MYS-${s}`;
}

/** Lock duration after `failures` failures (0 = not locked). */
export function lockMs(failures: number): number {
  if (failures < LOCK_AFTER) return 0;
  return Math.min(LOCK_BASE_MS * 2 ** (failures - LOCK_AFTER), LOCK_MAX_MS);
}

/** Friendly "locked" message. */
export function lockMessage(lockedUntil: number, now: number): string {
  const mins = Math.max(1, Math.ceil((lockedUntil - now) / 60000));
  return `Too many wrong tries. Take a chai break and try again in ${mins} min.`;
}

export const loginKey = (loginId: string) => `login:${loginId}`;
export const codeKey = (code: string) => `code:${code}`;
