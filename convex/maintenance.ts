// Housekeeping run by crons.ts: orphan uploads, expired sessions, stale lockout rows. created by viraj
import { internalMutation } from "./_generated/server";
import { ATTEMPT_RESET_MS } from "./lib/validate";

const ORPHAN_AGE_MS = 6 * 60 * 60 * 1000; // uploads never committed after 6 h
const BATCH = 200;

/** Delete uploaded files that no stall points at (refused or abandoned uploads). */
export const sweepOrphanUploads = internalMutation({
  args: {},
  handler: async ctx => {
    const cutoff = Date.now() - ORPHAN_AGE_MS;
    let deleted = 0;
    let scanned = 0;
    for await (const file of ctx.db.system.query("_storage").order("asc")) {
      if (file._creationTime > cutoff || scanned >= 2000 || deleted >= BATCH) break;
      scanned++;
      const used = await ctx.db.query("stalls").withIndex("by_snapshot", q => q.eq("snapshotId", file._id)).first();
      if (!used) {
        await ctx.storage.delete(file._id);
        deleted++;
      }
    }
    return { scanned, deleted };
  },
});

/** Drop expired sessions and old lockout counters. */
export const sweepSessions = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    let removed = 0;
    for await (const s of ctx.db.query("sessions")) {
      if (removed >= BATCH) break;
      if (s.expiresAt <= now) {
        await ctx.db.delete("sessions", s._id);
        removed++;
      }
    }
    for await (const a of ctx.db.query("loginAttempts")) {
      if (removed >= BATCH * 2) break;
      if (a.lockedUntil <= now && now - a.updatedAt > ATTEMPT_RESET_MS) {
        await ctx.db.delete("loginAttempts", a._id);
        removed++;
      }
    }
    return { removed };
  },
});
