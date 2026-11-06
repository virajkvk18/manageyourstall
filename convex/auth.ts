// MYS accounts & sessions (ARCHITECTURE.md §17.3). Password hashing runs in authNode.ts ("use node"). created by viraj
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { findSession, publicUser, requireUser } from "./lib/session";
import { ATTEMPT_RESET_MS, cleanName, fail, lockMs, SESSION_TTL_MS } from "./lib/validate";
import { clearAttempts, unwrap } from "./lib/util";

export type PublicUser = { id: string; loginId: string; name: string };
export type AuthResult = { token: string; user: PublicUser };

const deviceArgs = { deviceId: v.optional(v.string()), deviceLabel: v.optional(v.string()) };

// ---------------------------------------------------------------- public API

/** Create an account and sign this device in. → {token, user} */
export const signUp = action({
  args: { loginId: v.string(), password: v.string(), name: v.optional(v.string()), ...deviceArgs },
  handler: async (ctx, args): Promise<AuthResult> => unwrap(await ctx.runAction(internal.authNode.signUp, args)),
});

/** Log in with login ID + password. → {token, user} */
export const logIn = action({
  args: { loginId: v.string(), password: v.string(), ...deviceArgs },
  handler: async (ctx, args): Promise<AuthResult> => unwrap(await ctx.runAction(internal.authNode.logIn, args)),
});

/** Change the account password; every other session of the account is signed out. → null */
export const changePassword = action({
  args: { token: v.string(), oldPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<null> => unwrap(await ctx.runAction(internal.authNode.changePassword, args)),
});

/** Sign this device out (no error if the session is already gone). → null */
export const logOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await findSession(ctx, token);
    if (session) await ctx.db.delete("sessions", session._id);
    return null;
  },
});

/** Who is this token? → null | {user, kind, stallId?, stall?} (team sessions: user null + their stall). */
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await findSession(ctx, token);
    if (!session) return null;
    if (session.kind === "stall") {
      const stall = session.stallId ? await ctx.db.get("stalls", session.stallId) : null;
      if (!stall) return null;
      return {
        user: null,
        kind: "stall" as const,
        stallId: stall._id as string,
        stall: { id: stall._id as string, code: stall.code, name: stall.name },
        expiresAt: session.expiresAt,
      };
    }
    const user = session.userId ? await ctx.db.get("users", session.userId) : null;
    if (!user) return null;
    return { user: publicUser(user), kind: "user" as const, expiresAt: session.expiresAt };
  },
});

/** Change the account's display name (≤ 60 chars). → user */
export const updateProfile = mutation({
  args: { token: v.string(), name: v.string() },
  handler: async (ctx, { token, name }) => {
    const { user } = await requireUser(ctx, token);
    const clean = cleanName(name, "");
    if (!clean) fail("Enter your name.");
    await ctx.db.patch("users", user._id, { name: clean });
    return publicUser({ ...user, name: clean });
  },
});

// ---------------------------------------------------------------- internal helpers for the node actions

export const userByLoginId = internalQuery({
  args: { loginId: v.string() },
  handler: async (ctx, { loginId }) =>
    await ctx.db.query("users").withIndex("by_loginId", q => q.eq("loginId", loginId)).unique(),
});

/** The user behind an account session (by token hash), or null. */
export const userForTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("sessions").withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!session || session.expiresAt <= Date.now()) return null;
    if (session.kind !== "user" || !session.userId) return { session, user: null };
    const user = await ctx.db.get("users", session.userId);
    return { session, user };
  },
});

/** Latest lockedUntil (epoch ms) across keys, 0 when none is locked. */
export const lockStatus = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const now = Date.now();
    let lockedUntil = 0;
    for (const key of keys) {
      const row = await ctx.db.query("loginAttempts").withIndex("by_key", q => q.eq("key", key)).unique();
      if (row && row.lockedUntil > now) lockedUntil = Math.max(lockedUntil, row.lockedUntil);
    }
    return lockedUntil;
  },
});

/** Count a failed attempt for each key; returns the resulting lockedUntil (0 = not locked). */
export const recordFailure = internalMutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const now = Date.now();
    let lockedUntil = 0;
    for (const key of keys) {
      const row = await ctx.db.query("loginAttempts").withIndex("by_key", q => q.eq("key", key)).unique();
      const failures = row && now - row.updatedAt < ATTEMPT_RESET_MS ? row.failures + 1 : 1;
      const lock = lockMs(failures);
      const until = lock ? now + lock : 0;
      lockedUntil = Math.max(lockedUntil, until);
      if (row) await ctx.db.patch("loginAttempts", row._id, { failures, lockedUntil: until, updatedAt: now });
      else await ctx.db.insert("loginAttempts", { key, failures, lockedUntil: until, updatedAt: now });
    }
    return lockedUntil;
  },
});

const sessionFields = { tokenHash: v.string(), deviceId: v.string(), deviceLabel: v.string() };

/** Insert a new user and their first session. Refuses a taken login ID. */
export const createUser = internalMutation({
  args: { loginId: v.string(), name: v.string(), passwordHash: v.string(), passwordSalt: v.string(), ...sessionFields },
  handler: async (ctx, args) => {
    const taken = await ctx.db.query("users").withIndex("by_loginId", q => q.eq("loginId", args.loginId)).first();
    if (taken) fail("That login ID is already taken. Log in instead, or pick another one.");
    const nowIso = new Date().toISOString();
    const userId = await ctx.db.insert("users", {
      loginId: args.loginId,
      name: args.name,
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      createdAt: nowIso,
      lastLoginAt: nowIso,
    });
    const now = Date.now();
    await ctx.db.insert("sessions", {
      tokenHash: args.tokenHash,
      kind: "user",
      userId,
      deviceId: args.deviceId,
      deviceLabel: args.deviceLabel,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    return { id: userId as string, loginId: args.loginId, name: args.name };
  },
});

/** Insert an account session after a verified login and clear the lockout counters. */
export const createUserSession = internalMutation({
  args: { userId: v.id("users"), clearKeys: v.array(v.string()), ...sessionFields },
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user) fail("Login ID or password is wrong.");
    await clearAttempts(ctx, args.clearKeys);
    const now = Date.now();
    await ctx.db.insert("sessions", {
      tokenHash: args.tokenHash,
      kind: "user",
      userId: user._id,
      deviceId: args.deviceId,
      deviceLabel: args.deviceLabel,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    await ctx.db.patch("users", user._id, { lastLoginAt: new Date(now).toISOString() });
    return publicUser(user);
  },
});

/** Store a new password hash and sign out every other session of the account. */
export const setPassword = internalMutation({
  args: {
    userId: v.id("users"),
    keepSessionId: v.id("sessions"),
    expectHash: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    clearKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user) fail("You're logged out. Please log in again.");
    // The password changed elsewhere while we were hashing: make the person try again.
    if (user.passwordHash !== args.expectHash) fail("Your password was just changed on another device. Please log in again.");
    await ctx.db.patch("users", user._id, { passwordHash: args.passwordHash, passwordSalt: args.passwordSalt });
    const sessions = await ctx.db.query("sessions").withIndex("by_user", q => q.eq("userId", user._id)).collect();
    for (const s of sessions) if (s._id !== args.keepSessionId) await ctx.db.delete("sessions", s._id);
    await clearAttempts(ctx, args.clearKeys);
    return null;
  },
});
