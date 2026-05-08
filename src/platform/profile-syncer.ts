import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IProfileSyncer, IDesktopApp } from "./interfaces.js";
import type { Profile } from "../types.js";
import { readJson, writeJson } from "../config.js";
import * as logger from "../logger.js";

interface DesktopMeta {
  appliedId?: string;
  entries?: Array<{ id: string; name: string }>;
}

interface DesktopProfileData {
  inferenceProvider?: string;
  inferenceGatewayBaseUrl?: string;
  inferenceGatewayApiKey?: string;
  inferenceGatewayAuthScheme?: string;
  inferenceModels?: Array<{ name: string; supports1m: boolean }>;
  inferenceModelMappings?: Array<{ alias: string; actual: string }>;
}

const ANTHROPIC_ALIASES = ["claude-sonnet-4-5", "claude-opus-4-7", "claude-haiku-4-5-20251001"];

export function isAnthropicModel(model: string): boolean {
  const anthropicAliases = ["opus", "sonnet", "haiku", "best", "default", "opusplan", "opus[1m]", "sonnet[1m]"];
  const lower = model.toLowerCase();
  if (anthropicAliases.includes(lower)) return true;
  if (lower.startsWith("claude-")) return true;
  return false;
}

export function toDesktopProfile(p: Profile): DesktopProfileData {
  const models = p.models || (p.model ? [p.model] : []);
  const isAnthropic = p.provider === "anthropic" || (!p.provider && !p.url);

  if (isAnthropic && !p.url) {
    return {
      inferenceProvider: "1p",
      inferenceModels: models.map((m) => ({ name: m, supports1m: true })),
    };
  }

  const mappings: Array<{ alias: string; actual: string }> = [];
  const mappedModels = models.map((m, index) => {
    if (isAnthropicModel(m)) return m;
    const alias = ANTHROPIC_ALIASES[Math.min(index, ANTHROPIC_ALIASES.length - 1)];
    mappings.push({ alias, actual: m });
    return alias;
  });

  const result: DesktopProfileData = {
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: p.url || undefined,
    inferenceGatewayApiKey: p.token || undefined,
    inferenceGatewayAuthScheme: "bearer",
    inferenceModels: mappedModels.map((m) => ({ name: m, supports1m: true })),
  };

  if (mappings.length > 0) {
    result.inferenceModelMappings = mappings;
  }

  return result;
}

export class DesktopProfileSyncer implements IProfileSyncer {
  constructor(private app: IDesktopApp) {}

  isSupported(): boolean {
    return this.app.isInstalled();
  }

  sync(name: string, p: Profile): void {
    const configLib = this.app.getConfigLibrary();
    logger.debug(`profile-syncer: sync '${name}' to ${configLib || "(none)"}`);
    if (!configLib) return;
    if (!fs.existsSync(configLib)) {
      fs.mkdirSync(configLib, { recursive: true });
    }

    const meta = this.readMeta();
    const entries = meta.entries || [];
    let id = p.desktopId;

    if (!id) {
      const existingByName = entries.find((e) => e.name === name);
      if (existingByName) {
        id = existingByName.id;
      } else {
        id = randomUUID();
      }
      p.desktopId = id;
    }

    const existingIndex = entries.findIndex((e) => e.id === id);
    if (existingIndex !== -1) {
      entries[existingIndex].name = name;
    } else {
      entries.push({ id, name });
    }

    meta.entries = entries;
    this.writeMeta(meta);
    this.writeProfile(id, configLib, toDesktopProfile(p));
    logger.debug(`profile-syncer: synced '${name}' id=${id}`);
  }

  remove(name: string, p: Profile): void {
    const configLib = this.app.getConfigLibrary();
    logger.debug(`profile-syncer: remove '${name}' id=${p.desktopId || "(none)"} from ${configLib || "(none)"}`);
    if (!configLib || !p.desktopId) return;

    const meta = this.readMeta();
    if (meta.entries) {
      meta.entries = meta.entries.filter((e) => e.id !== p.desktopId);
    }
    if (meta.appliedId === p.desktopId) {
      delete meta.appliedId;
    }
    this.writeMeta(meta);

    const filePath = path.join(configLib, `${p.desktopId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  setActive(p: Profile): void {
    const configLib = this.app.getConfigLibrary();
    logger.debug(`profile-syncer: setActive id=${p.desktopId || "(none)"} in ${configLib || "(none)"}`);
    if (!configLib || !p.desktopId) return;

    const meta = this.readMeta();
    meta.appliedId = p.desktopId;
    const entries = meta.entries || [];
    if (!entries.some((e) => e.id === p.desktopId)) {
      entries.push({ id: p.desktopId, name: "unknown" });
      meta.entries = entries;
    }
    this.writeMeta(meta);
  }

  private metaFile(): string | undefined {
    const configLib = this.app.getConfigLibrary();
    return configLib ? path.join(configLib, "_meta.json") : undefined;
  }

  private readMeta(): DesktopMeta {
    const file = this.metaFile();
    if (!file || !fs.existsSync(file)) return {};
    try {
      return readJson<DesktopMeta>(file);
    } catch {
      return {};
    }
  }

  private writeMeta(meta: DesktopMeta): void {
    const file = this.metaFile();
    if (file) writeJson(file, meta);
  }

  private writeProfile(id: string, configLib: string, data: DesktopProfileData): void {
    writeJson(path.join(configLib, `${id}.json`), data);
  }
}
