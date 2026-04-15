export interface Profile {
  model?: string;
  token?: string;
  url?: string;
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
