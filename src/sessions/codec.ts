import { createPathCodec } from "../platform/index.js";

export function encodePath(p: string): string {
  return createPathCodec().encode(p);
}

export function decodePath(encoded: string): string {
  return createPathCodec().decode(encoded);
}
