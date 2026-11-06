"use node";
// Password crypto for MYS accounts & team access (ARCHITECTURE.md §17.3). Node runtime: scrypt + timingSafeEqual.
// created by viraj
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { guard, type NodeResult } from "./lib/util";
import {
  checkLoginId,
  checkPassword,
  cleanName,
  clip,
  fail,
  lockMessage,
  loginKey,
  normalizeLoginId,
} from "./lib/validate";

type PublicUser = { id: string; loginId: string; name: string };
type AuthResult = { token: string; user: PublicUser };

const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt(password, salt) → base64 key. */
function scryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hash a new password with a fresh 16-byte salt. */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const key = await scryptKey(password, salt);
  return { hash: key.toString("base64"), salt: salt.toString("base64") };
}

/** Constant-time check of a password against a stored hash/salt. Without a stored hash it still burns the same time. */
export async function verifyPassword(password: string, hash?: string | null, salt?: string | null): Promise<boolean> {
  const saltBuf = salt ? Buffer.from(salt, "base64") : randomBytes(16);
  const key = await scryptKey(password, saltBuf);
  if (!hash) return false;
  const want = Buffer.from(hash, "base64");
  return want.length === key.length && timingSafeEqual(want, key);
}

/** A new session token (32 random bytes, base64url) and its SHA-256 hex (the only thing stored). */
export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function device(args: { deviceId?: string; deviceLabel?: string }) {
  return { deviceId: clip(args.deviceId, 100), deviceLabel: clip(args.deviceLabel, 100) || "Unknown device" };
}

const WRONG_LOGIN = "Login ID or password is wrong.";

export const signUp = internalAction({
  args: {
    loginId: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    deviceLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NodeResult<AuthResult>> =>
    guard(async () => {
      const loginId = checkLoginId(args.loginId);
      checkPassword(args.password);
      const name = cleanName(args.name, loginId.split("@")[0].slice(0, 60));
      const taken = await ctx.runQuery(internal.auth.userByLoginId, { loginId });
      if (taken) fail("That login ID is already taken. Log in instead, or pick another one.");
      const { hash, salt } = await hashPassword(args.password);
      const { token, tokenHash } = newToken();
      const user: PublicUser = await ctx.runMutation(internal.auth.createUser, {
        loginId,
        name,
        passwordHash: hash,
        passwordSalt: salt,
        tokenHash,
        ...device(args),
      });
      return { token, user };
    }),
});

export const logIn = internalAction({
  args: {
    loginId: v.string(),
    password: v.string(),
    deviceId: v.optional(v.string()),
    deviceLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NodeResult<AuthResult>> =>
    guard(async () => {
      const loginId = normalizeLoginId(args.loginId);
      if (!loginId) fail("Enter your login ID.");
      if (!args.password) fail("Enter your password.");
      if (loginId.length > 60 || args.password.length > 100) fail(WRONG_LOGIN);
      const keys = [loginKey(loginId)];
      const now = Date.now();
      const lockedUntil: number = await ctx.runQuery(internal.auth.lockStatus, { keys });
      if (lockedUntil > now) fail(lockMessage(lockedUntil, now));
      const user = await ctx.runQuery(internal.auth.userByLoginId, { loginId });
      const ok = await verifyPassword(args.password, user?.passwordHash, user?.passwordSalt);
      if (!ok || !user) {
        const until: number = await ctx.runMutation(internal.auth.recordFailure, { keys });
        if (until > Date.now()) fail(`${WRONG_LOGIN} ${lockMessage(until, Date.now())}`);
        fail(WRONG_LOGIN);
      }
      const { token, tokenHash } = newToken();
      const publicUser: PublicUser = await ctx.runMutation(internal.auth.createUserSession, {
        userId: user._id as Id<"users">,
        clearKeys: keys,
        tokenHash,
        ...device(args),
      });
      return { token, user: publicUser };
    }),
});

export const changePassword = internalAction({
  args: { token: v.string(), oldPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<NodeResult<null>> =>
    guard(async () => {
      const found = await ctx.runQuery(internal.auth.userForTokenHash, { tokenHash: sha256Hex(String(args.token)) });
      if (!found) fail("You're logged out. Please log in again.");
      if (!found.user) fail("Team logins can't change passwords. Log in with the owner's MYS account.");
      const user = found.user;
      const keys = [loginKey(user.loginId)];
      const now = Date.now();
      const lockedUntil: number = await ctx.runQuery(internal.auth.lockStatus, { keys });
      if (lockedUntil > now) fail(lockMessage(lockedUntil, now));
      if (!args.oldPassword) fail("Enter your current password.");
      const ok = await verifyPassword(args.oldPassword.slice(0, 200), user.passwordHash, user.passwordSalt);
      if (!ok) {
        const until: number = await ctx.runMutation(internal.auth.recordFailure, { keys });
        if (until > Date.now()) fail(`Current password is wrong. ${lockMessage(until, Date.now())}`);
        fail("Current password is wrong.");
      }
      checkPassword(args.newPassword, "New password");
      const { hash, salt } = await hashPassword(args.newPassword);
      await ctx.runMutation(internal.auth.setPassword, {
        userId: user._id,
        keepSessionId: found.session._id,
        expectHash: user.passwordHash,
        passwordHash: hash,
        passwordSalt: salt,
        clearKeys: keys,
      });
      return null;
    }),
});
