// Session lookup and access checks for queries & mutations (ARCHITECTURE.md §17.3). created by viraj
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { fail } from "./validate";

const HEX = "0123456789abcdef";

/** SHA-256 hex of a string (Web Crypto; same output as Node's createHash('sha256').digest('hex')). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const b of new Uint8Array(digest)) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

/** The live (non-expired) session for a token, or null. */
export async function findSession(ctx: QueryCtx, token: string): Promise<Doc<"sessions"> | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const tokenHash = await sha256Hex(token);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session || session.expiresAt <= Date.now()) return null;
  return session;
}

export const SIGNED_OUT = "You're logged out. Please log in again.";

/** A live session or a friendly error. */
export async function requireSession(ctx: QueryCtx, token: string): Promise<Doc<"sessions">> {
  const session = await findSession(ctx, token);
  if (!session) fail(SIGNED_OUT);
  return session;
}

/** A live account (kind 'user') session and its user, or a friendly error. */
export async function requireUser(ctx: QueryCtx, token: string): Promise<{ session: Doc<"sessions">; user: Doc<"users"> }> {
  const session = await requireSession(ctx, token);
  if (session.kind !== "user" || !session.userId) fail("Team logins can't do this. Log in with the owner's MYS account.");
  const user = await ctx.db.get("users", session.userId);
  if (!user) fail(SIGNED_OUT);
  return { session, user };
}

/**
 * Resolve a stall the session may use. Owners (user sessions) reach their own stalls; team sessions reach only their stall.
 * ownerOnly refuses team sessions.
 */
export async function requireStall(
  ctx: QueryCtx,
  token: string,
  stallId: string,
  ownerOnly = false,
): Promise<{ session: Doc<"sessions">; stall: Doc<"stalls"> }> {
  const session = await requireSession(ctx, token);
  const id = ctx.db.normalizeId("stalls", String(stallId ?? ""));
  const stall = id ? await ctx.db.get("stalls", id) : null;
  if (session.kind === "stall") {
    if (ownerOnly) fail("Only the stall owner can do this. Log in with the owner's MYS account.");
    if (!stall || session.stallId !== stall._id) fail("This team login only works for its own stall.");
    return { session, stall };
  }
  if (!stall || stall.archived || stall.ownerId !== session.userId) fail("Stall not found in your account.");
  return { session, stall };
}

/** Public shape of a user. */
export function publicUser(user: Doc<"users">) {
  return { id: user._id as string, loginId: user.loginId, name: user.name };
}

/** Public shape of a stall (stalls:list row). */
export function publicStall(stall: Doc<"stalls">) {
  return {
    id: stall._id as string,
    code: stall.code,
    name: stall.name,
    booth: stall.booth,
    themeId: stall.themeId,
    accent: stall.accent,
    heroArt: stall.heroArt,
    eventName: stall.eventName,
    city: stall.city,
    revision: stall.revision,
    snapshotAt: stall.snapshotAt ?? null,
    snapshotDevice: stall.snapshotDevice ?? null,
    snapshotBytes: stall.snapshotBytes,
    summary: stall.summary,
    hasTeamPassword: Boolean(stall.teamPasswordHash),
    createdAt: stall.createdAt,
    updatedAt: stall.updatedAt,
  };
}

/** Delete every session of a stall's team (used when team access changes or the stall goes). */
export async function deleteStallSessions(ctx: MutationCtx, stallId: Id<"stalls">, keep?: Id<"sessions">) {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_stall", q => q.eq("stallId", stallId))
    .collect();
  for (const s of sessions) if (s._id !== keep) await ctx.db.delete("sessions", s._id);
}
