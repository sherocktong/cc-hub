import { SETTINGS_FILE, ensureSettingsFile, readJson, writeJson } from "../config.js";
import type { SettingsData } from "../types.js";

export function getPinnedVersion(): string | undefined {
  ensureSettingsFile();
  const settings = readJson<SettingsData>(SETTINGS_FILE);
  return settings._cc_hub_pinnedClaudeVersion;
}

export function setPinnedVersion(version: string | undefined): void {
  ensureSettingsFile();
  const settings = readJson<SettingsData>(SETTINGS_FILE);
  if (version) {
    settings._cc_hub_pinnedClaudeVersion = version;
    settings.minimumVersion = version;
    settings.requiredMaximumVersion = version;
  } else {
    delete settings._cc_hub_pinnedClaudeVersion;
    delete settings.minimumVersion;
    delete settings.requiredMaximumVersion;
  }
  writeJson(SETTINGS_FILE, settings);
}
