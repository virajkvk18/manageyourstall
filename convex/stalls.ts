// MYS cloud stalls: info, snapshots, team access (ARCHITECTURE.md §17.3). created by viraj
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteStallSessions, publicStall, requireSession, requireStall, requireUser } from "./lib/session";
import { clearAttempts, unwrap } from "./lib/util";
import {
  CODE_ALPHABET,
  cleanInfo,
  cleanSummary,
  clip,
  fail,
  MAX_SNAPSHOT_BYTES,
  SESSION_TTL_MS,
  stallInfoValidator,
  summaryValidator,
} from "./lib/validate";

type JoinResult = { token: string; stall: { id: string; code: string; name: string } };

function randomCode(): string {
  let code = "MYS-";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

// ---------------------------------------------------------------- queries

/** Owner: their stalls (newest first). Team session: just its stall. */
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await requireSession(ctx, token);
    if (session.kind === "stall") {
      const stall = session.stallId ? await ctx.db.get("stalls", session.stallId) : null;
      return stall ? [publicStall(stall)] : [];
    }
    const stalls = await ctx.db
      .query("stalls")
      .withIndex("by_owner", q => q.eq("ownerId", session.userId as Id<"users">))
      .collect();
    return stalls
      .filter(s => !s.archived)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map(publicStall);
  },
});

/** Where to download the latest snapshot. → null | {url, revision, snapshotAt, snapshotDevice, bytes} */
export const getSnapshot = query({
  args: { token: v.string(), stallId: v.string() },
  handler: async (ctx, { token, stallId }) => {
    const { stall } = await requireStall(ctx, token, stallId);
    if (!stall.snapshotId) return null;
    const url = await ctx.storage.getUrl(stall.snapshotId);
    if (!url) return null;
    return {
      url,
      revision: stall.revision,
      snapshotAt: stall.snapshotAt ?? null,
      snapshotDevice: stall.snapshotDevice ?? null,
      bytes: stall.snapshotBytes,
    };
  },
});

// ---------------------------------------------------------------- mutations

/** Create an empty cloud stall for the signed-in account. → {id, code} */
export const create = mutation({
  args: { token: v.string(), info: stallInfoValidator },
  handler: async (ctx, { token, info }) => {
    const { user } = await requireUser(ctx, token);
    const clean = cleanInfo(info, true);
    const owned = await ctx.db.query("stalls").withIndex("by_owner", q => q.eq("ownerId", user._id)).take(201);
    if (owned.length >= 200) fail("You already have 200 stalls in your account. Remove one first.");
    let code = randomCode();
    for (let i = 0; ; i++) {
      const clash = await ctx.db.query("stalls").withIndex("by_code", q => q.eq("code", code)).first();
      if (!clash) break;
      if (i >= 20) fail("Couldn't make a stall code right now. Please try again.");
      code = randomCode();
    }
    const nowIso = new Date().toISOString();
    const id = await ctx.db.insert("stalls", {
      ownerId: user._id,
      code,
      name: clean.name ?? "",
      booth: clean.booth ?? "",
      themeId: clean.themeId ?? "",
      accent: clean.accent ?? "",
      heroArt: clean.heroArt ?? [],
      eventName: clean.eventName ?? "",
      city: clean.city ?? "",
      revision: 0,
      snapshotBytes: 0,
      summary: { orders: 0, collected: 0, bills: 0 },
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return { id: id as string, code };
  },
});

/** Update the stall card info (only the fields sent). Owner or its team. → stall row */
export const updateInfo = mutation({
  args: { token: v.string(), stallId: v.string(), info: stallInfoValidator },
  handler: async (ctx, { token, stallId, info }) => {
    const { stall } = await requireStall(ctx, token, stallId);
    const patch = { ...cleanInfo(info, false), updatedAt: new Date().toISOString() };
    await ctx.db.patch("stalls", stall._id, patch);
    return publicStall({ ...stall, ...patch });
  },
});

/** Delete a cloud stall (owner only): its snapshot file and team sessions go too. → null */
export const remove = mutation({
  args: { token: v.string(), stallId: v.string() },
  handler: async (ctx, { token, stallId }) => {
    const { stall } = await requireStall(ctx, token, stallId, true);
    if (stall.snapshotId) await ctx.storage.delete(stall.snapshotId);
    await deleteStallSessions(ctx, stall._id);
    await ctx.db.delete("stalls", stall._id);
    return null;
  },
});

/** A one-time URL to POST a snapshot file to. → url (string) */
export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Make an uploaded snapshot the stall's latest copy, with an optimistic revision check.
 * → {ok: true, revision} | {ok: false, conflict: true, revision, snapshotAt, snapshotDevice}
 */
export const commitSnapshot = mutation({
  args: {
    token: v.string(),
    stallId: v.string(),
    storageId: v.id("_storage"),
    baseRevision: v.number(),
    bytes: v.number(),
    summary: summaryValidator,
    info: v.optional(v.union(stallInfoValidator, v.null())),
    device: v.optional(v.union(v.string(), v.null())),
    force: v.optional(v.union(v.boolean(), v.null())),
  },
  handler: async (ctx, args) => {
    const { stall } = await requireStall(ctx, args.token, args.stallId);
    // Never touch a file that already belongs to a stall (ours or anyone's).
    const owner = await ctx.db.query("stalls").withIndex("by_snapshot", q => q.eq("snapshotId", args.storageId)).first();
    if (owner) fail("That upload was already used. Please sync again.");
    const file = await ctx.db.system.get("_storage", args.storageId);
    if (!file) fail("The upload didn't arrive. Please sync again.");
    // (A refused upload is left for the hourly orphan sweep in maintenance.ts: a thrown error rolls back deletes.)
    if (file.size > MAX_SNAPSHOT_BYTES || args.bytes > MAX_SNAPSHOT_BYTES) {
      fail("This stall is over 50 MB (mostly photos). Remove a few big photos and sync again.");
    }
    if (!Number.isFinite(args.bytes) || args.bytes < 0) fail("Snapshot size looks wrong. Please sync again.");
    const summary = cleanSummary(args.summary);
    const info = args.info ? cleanInfo(args.info, false) : {};
    if (info.name === "") delete info.name;

    if (!args.force && args.baseRevision !== stall.revision) {
      await ctx.storage.delete(args.storageId);
      return {
        ok: false as const,
        conflict: true as const,
        revision: stall.revision,
        snapshotAt: stall.snapshotAt ?? null,
        snapshotDevice: stall.snapshotDevice ?? null,
      };
    }
    const previous = stall.snapshotId;
    const revision = stall.revision + 1;
    const nowIso = new Date().toISOString();
    await ctx.db.patch("stalls", stall._id, {
      ...info,
      snapshotId: args.storageId,
      revision,
      snapshotBytes: file.size,
      snapshotAt: nowIso,
      snapshotDevice: clip(args.device, 100) || "Unknown device",
      summary,
      updatedAt: nowIso,
    });
    if (previous && previous !== args.storageId) await ctx.storage.delete(previous);
    return { ok: true as const, revision };
  },
});

// ---------------------------------------------------------------- team access (password crypto in stallsNode.ts)

/** Set or remove (null) the team password. Owner only. Existing team logins are signed out. → {hasTeamPassword} */
export const setTeamPassword = action({
  args: { token: v.string(), stallId: v.string(), password: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<{ hasTeamPassword: boolean }> =>
    unwrap(await ctx.runAction(internal.stallsNode.setTeamPassword, args)),
});

/** Join a stall as its team with code + team password. → {token, stall: {id, code, name}} */
export const join = action({
  args: { code: v.string(), password: v.string(), deviceId: v.optional(v.string()), deviceLabel: v.optional(v.string()) },
  handler: async (ctx, args): Promise<JoinResult> => unwrap(await ctx.runAction(internal.stallsNode.join, args)),
});

/** Owner check before hashing (throws a friendly error). */
export const checkOwner = internalQuery({
  args: { token: v.string(), stallId: v.string() },
  handler: async (ctx, { token, stallId }) => {
    const { stall } = await requireStall(ctx, token, stallId, true);
    return stall._id;
  },
});

export const writeTeamPassword = internalMutation({
  args: {
    token: v.string(),
    stallId: v.string(),
    hash: v.union(v.string(), v.null()),
    salt: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const { stall } = await requireStall(ctx, args.token, args.stallId, true);
    await ctx.db.patch("stalls", stall._id, {
      teamPasswordHash: args.hash ?? undefined,
      teamPasswordSalt: args.salt ?? undefined,
      updatedAt: new Date().toISOString(),
    });
    await deleteStallSessions(ctx, stall._id);
    return { hasTeamPassword: Boolean(args.hash) };
  },
});

export const stallByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<Doc<"stalls"> | null> => {
    const stall = await ctx.db.query("stalls").withIndex("by_code", q => q.eq("code", code)).first();
    return stall && !stall.archived ? stall : null;
  },
});

export const createTeamSession = internalMutation({
  args: {
    stallId: v.id("stalls"),
    expectHash: v.string(),
    clearKeys: v.array(v.string()),
    tokenHash: v.string(),
    deviceId: v.string(),
    deviceLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const stall = await ctx.db.get("stalls", args.stallId);
    if (!stall || stall.teamPasswordHash !== args.expectHash) fail("Stall code or team password is wrong.");
    await clearAttempts(ctx, args.clearKeys);
    const now = Date.now();
    await ctx.db.insert("sessions", {
      tokenHash: args.tokenHash,
      kind: "stall",
      stallId: stall._id,
      deviceId: args.deviceId,
      deviceLabel: args.deviceLabel,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    return { id: stall._id as string, code: stall.code, name: stall.name };
  },
});
