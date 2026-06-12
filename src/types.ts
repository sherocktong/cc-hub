export type ProviderType = "anthropic" | "openai" | "kimi";

export interface Profile {
  model?: string;
  models?: string[];
  token?: string;
  url?: string;
  provider?: ProviderType;
  desktopId?: string;
}

export interface ProfilesData {
  profiles: Record<string, Profile>;
  default?: string;
  _cc_hub_seq?: number;
}

export interface HookEntry {
  type: string;
  command: string;
  _seq: number;
  async?: boolean;
  event?: string;
  matcher?: string;
}

export interface HookGroup {
  matcher?: string;
  hooks: Array<{ type: string; command: string; _seq: number; async?: boolean }>;
}

export interface SettingsData {
  hooks?: Record<string, HookGroup[]>;
  _cc_hub_disabled?: HookEntry[];
  _cc_hub_seq?: number;
  _cc_hub_logLevel?: string;
  _cc_hub_pinnedClaudeVersion?: string;
  autoUpdatesChannel?: string;
  minimumVersion?: string;
  requiredMaximumVersion?: string;
  [key: string]: unknown;
}

export interface FlatHook {
  seq: number;
  active: boolean;
  event: string;
  matcher: string;
  command: string;
  gi: number;
  hi: number;
  di: number;
}

export interface SessionInfo {
  sessionId: string;
  pid: number;
  cwd: string;
  startedAt: number;
}
