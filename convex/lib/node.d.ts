// Minimal Node typings for the "use node" actions (the project ships no @types/node). Only what authNode.ts uses.
// (Convex skips files with more than one dot, so this is never bundled.)

declare class Buffer extends Uint8Array {
  static from(data: string, encoding: "base64" | "base64url" | "hex" | "utf8"): Buffer;
  toString(encoding?: "base64" | "base64url" | "hex" | "utf8"): string;
}

declare module "node:crypto" {
  export function randomBytes(size: number): Buffer;
  export function scrypt(
    password: string | Uint8Array,
    salt: Uint8Array,
    keylen: number,
    options: { N?: number; r?: number; p?: number; maxmem?: number },
    callback: (err: Error | null, derivedKey: Buffer) => void,
  ): void;
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  export function createHash(algorithm: "sha256"): {
    update(data: string, encoding?: "utf8"): { digest(encoding: "hex"): string };
  };
}
