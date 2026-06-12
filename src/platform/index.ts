import { MacOSDesktopApp, WindowsDesktopApp, NoOpDesktopApp } from "./desktop-app.js";
import { DesktopProfileSyncer } from "./profile-syncer.js";
import { SystemBinaryResolver } from "./binary-resolver.js";
import { UnixPathCodec, WindowsPathCodec } from "./path-codec.js";
import type { IDesktopApp, IProfileSyncer, IBinaryResolver, IPathCodec } from "./interfaces.js";

export function createDesktopApp(): IDesktopApp {
  if (process.platform === "darwin") return new MacOSDesktopApp();
  if (process.platform === "win32") return new WindowsDesktopApp();
  return new NoOpDesktopApp();
}

export function createProfileSyncer(): IProfileSyncer {
  return new DesktopProfileSyncer(createDesktopApp());
}

export function createBinaryResolver(): IBinaryResolver {
  return new SystemBinaryResolver(createDesktopApp());
}

export function createPathCodec(): IPathCodec {
  if (process.platform === "win32") return new WindowsPathCodec();
  return new UnixPathCodec();
}

export { getClaudeVersion } from "./binary-resolver.js";
export type { IDesktopApp, IProfileSyncer, IBinaryResolver, IPathCodec };
