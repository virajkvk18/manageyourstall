// ManageYourStall (MYS) — Convex schema (ARCHITECTURE.md §17.3). created by viraj
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /** MYS accounts. loginId is normalized (trimmed, lowercased). Times are ISO strings. */
  users: defineTable({
    loginId: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.string(),
    lastLoginAt: v.string(),
  }).index("by_loginId", ["loginId"]),

  /** Login sessions. Only the SHA-256 hex of the token is stored. Times are epoch ms. */
  sessions: defineTable({
    tokenHash: v.string(),
    kind: v.union(v.literal("user"), v.literal("stall")),
    userId: v.optional(v.id("users")),
    stallId: v.optional(v.id("stalls")),
    deviceId: v.string(),
    deviceLabel: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"])
    .index("by_stall", ["stallId"]),

  /** Failed login counters for lockout. key = 'login:<loginId>' | 'code:<MYS-XXXXX>'. Times are epoch ms. */
  loginAttempts: defineTable({
    key: v.string(),
    failures: v.number(),
    lockedUntil: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Cloud stalls. The full stall lives in a JSON snapshot file (exportBackup) in file storage. */
  stalls: defineTable({
    ownerId: v.id("users"),
    code: v.string(),
    name: v.string(),
    booth: v.string(),
    themeId: v.string(),
    accent: v.string(),
    heroArt: v.array(v.string()),
    eventName: v.string(),
    city: v.string(),
    teamPasswordHash: v.optional(v.string()),
    teamPasswordSalt: v.optional(v.string()),
    snapshotId: v.optional(v.id("_storage")),
    revision: v.number(),
    snapshotBytes: v.number(),
    snapshotAt: v.optional(v.string()),
    snapshotDevice: v.optional(v.string()),
    summary: v.object({ orders: v.number(), collected: v.number(), bills: v.number() }),
    archived: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_code", ["code"])
    .index("by_snapshot", ["snapshotId"]),
});
