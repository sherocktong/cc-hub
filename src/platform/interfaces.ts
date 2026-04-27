import type { Profile } from "../types.js";

export interface IDesktopApp {
  isInstalled(): boolean;
  getSupportDir(): string | undefined;
  getSessionsDir(): string | undefined;
  getConfigLibrary(): string | undefined;
  findBinary(): string | undefined;
}

export interface IProfileSyncer {
  isSupported(): boolean;
  sync(name: string, profile: Profile): void;
  remove(name: string, profile: Profile): void;
  setActive(profile: Profile): void;
}

export interface IBinaryResolver {
  resolve(): string;
}

export interface IPathCodec {
  encode(p: string): string;
  decode(encoded: string): string;
}
