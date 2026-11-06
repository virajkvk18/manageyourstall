/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authNode from "../authNode.js";
import type * as crons from "../crons.js";
import type * as lib_session from "../lib/session.js";
import type * as lib_util from "../lib/util.js";
import type * as lib_validate from "../lib/validate.js";
import type * as maintenance from "../maintenance.js";
import type * as stalls from "../stalls.js";
import type * as stallsNode from "../stallsNode.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authNode: typeof authNode;
  crons: typeof crons;
  "lib/session": typeof lib_session;
  "lib/util": typeof lib_util;
  "lib/validate": typeof lib_validate;
  maintenance: typeof maintenance;
  stalls: typeof stalls;
  stallsNode: typeof stallsNode;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
