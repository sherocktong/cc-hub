import { SETTINGS_FILE, ensureSettingsFile, readJson, writeJson } from "../config.js";
import type { SettingsData } from "../types.js";

export function getPinnedVersion(): string | undefined {
  ensureSettingsFile();
  const settings = readJson<SettingsData>(SETTINGS_FILE);
  return settings.minimumVersion && settings.requiredMaximumVersion && settings.minimumVersion === settings.requiredMaximumVersion
    ? settings.minimumVersion
    : undefined;
}

export function setPinnedVersion(version: string | undefined): void {
  ensureSettingsFile();
  const settings = readJson<SettingsData>(SETTINGS_FILE);
  if (version) {
    settings.minimumVersion = version;
    settings.requiredMaximumVersion = version;
  } else {
    delete settings.minimumVersion;
    delete settings.requiredMaximumVersion;
  }
  writeJson(SETTINGS_FILE, settings);
}
