// Small shared helpers: node-action results and lockout counters. created by viraj
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/** What the node actions hand back: errors travel as data so the friendly message always survives. */
export type NodeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Turn a NodeResult into its value, or throw the friendly ConvexError for the client. */
export function unwrap<T>(result: NodeResult<T>): T {
  if (!result.ok) throw new ConvexError(result.error);
  return result.value;
}

/** Run fn; a ConvexError (thrown here or by a nested runQuery/runMutation) becomes {ok: false, error}. */
export async function guard<T>(fn: () => Promise<T>): Promise<NodeResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e: any) {
    if (e instanceof ConvexError || (e && typeof e.data === "string")) {
      return { ok: false, error: typeof e.data === "string" ? e.data : "Something went wrong. Please try again." };
    }
    throw e;
  }
}

/** Clear failure counters (after a successful login or join). */
export async function clearAttempts(ctx: MutationCtx, keys: string[]) {
  for (const key of keys) {
    const row = await ctx.db.query("loginAttempts").withIndex("by_key", q => q.eq("key", key)).unique();
    if (row) await ctx.db.delete("loginAttempts", row._id);
  }
}
