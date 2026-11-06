"use node";
// Team access crypto for cloud stalls (ARCHITECTURE.md §17.3). created by viraj
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { device, hashPassword, newToken, verifyPassword } from "./authNode";
import { guard, type NodeResult } from "./lib/util";
import { checkPassword, codeKey, fail, lockMessage, normalizeCode } from "./lib/validate";

type JoinResult = { token: string; stall: { id: string; code: string; name: string } };

const WRONG_JOIN = "Stall code or team password is wrong.";

export const setTeamPassword = internalAction({
  args: { token: v.string(), stallId: v.string(), password: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<NodeResult<{ hasTeamPassword: boolean }>> =>
    guard(async () => {
      await ctx.runQuery(internal.stalls.checkOwner, { token: args.token, stallId: args.stallId });
      let hash: string | null = null;
      let salt: string | null = null;
      if (args.password !== null) {
        checkPassword(args.password, "Team password");
        ({ hash, salt } = await hashPassword(args.password));
      }
      return await ctx.runMutation(internal.stalls.writeTeamPassword, {
        token: args.token,
        stallId: args.stallId,
        hash,
        salt,
      });
    }),
});

export const join = internalAction({
  args: { code: v.string(), password: v.string(), deviceId: v.optional(v.string()), deviceLabel: v.optional(v.string()) },
  handler: async (ctx, args): Promise<NodeResult<JoinResult>> =>
    guard(async () => {
      const code = normalizeCode(args.code);
      if (!code) fail("Stall codes look like MYS-AB3CD. Check it with the owner.");
      if (!args.password) fail("Enter the team password.");
      const keys = [codeKey(code)];
      const now = Date.now();
      const lockedUntil: number = await ctx.runQuery(internal.auth.lockStatus, { keys });
      if (lockedUntil > now) fail(lockMessage(lockedUntil, now));
      const stall = await ctx.runQuery(internal.stalls.stallByCode, { code });
      if (stall && !stall.teamPasswordHash) {
        fail("This stall has no team password yet. Ask the owner to set one in Team access.");
      }
      const ok = await verifyPassword(args.password.slice(0, 200), stall?.teamPasswordHash, stall?.teamPasswordSalt);
      if (!ok || !stall || !stall.teamPasswordHash) {
        const until: number = await ctx.runMutation(internal.auth.recordFailure, { keys });
        if (until > Date.now()) fail(`${WRONG_JOIN} ${lockMessage(until, Date.now())}`);
        fail(WRONG_JOIN);
      }
      const { token, tokenHash } = newToken();
      const info: JoinResult["stall"] = await ctx.runMutation(internal.stalls.createTeamSession, {
        stallId: stall._id,
        expectHash: stall.teamPasswordHash,
        clearKeys: keys,
        tokenHash,
        ...device(args),
      });
      return { token, stall: info };
    }),
});
