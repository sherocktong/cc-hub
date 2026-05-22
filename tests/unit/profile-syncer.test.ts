import { describe, it, expect } from "vitest";
import { toDesktopProfile, isAnthropicModel } from "../../src/platform/profile-syncer.js";
import type { Profile } from "../../src/types.js";

describe("isAnthropicModel", () => {
  it("returns true for Anthropic aliases", () => {
    expect(isAnthropicModel("opus")).toBe(true);
    expect(isAnthropicModel("sonnet")).toBe(true);
    expect(isAnthropicModel("haiku")).toBe(true);
    expect(isAnthropicModel("best")).toBe(true);
  });

  it("returns true for claude- prefixed models", () => {
    expect(isAnthropicModel("claude-sonnet-4-6")).toBe(true);
    expect(isAnthropicModel("claude-opus-4-7")).toBe(true);
    expect(isAnthropicModel("claude-haiku-3")).toBe(true);
  });

  it("returns false for non-Anthropic models", () => {
    expect(isAnthropicModel("gpt-5.2")).toBe(false);
    expect(isAnthropicModel("gpt-4o")).toBe(false);
    expect(isAnthropicModel("gpt-3.5-turbo")).toBe(false);
    expect(isAnthropicModel("kimi-k2.5")).toBe(false);
  });
});

describe("toDesktopProfile", () => {
  it("passes through Anthropic models for 1p provider", () => {
    const p: Profile = {
      provider: "anthropic",
      models: ["claude-sonnet-4-6", "claude-opus-4-7"],
    };
    const result = toDesktopProfile(p);
    expect(result.inferenceProvider).toBe("1p");
    expect(result.inferenceModels).toEqual([
      { name: "claude-sonnet-4-6", supports1m: true },
      { name: "claude-opus-4-7", supports1m: true },
    ]);
    expect(result.inferenceModelMappings).toBeUndefined();
  });

  it("maps non-Anthropic models to Anthropic aliases for gateway provider", () => {
    const p: Profile = {
      provider: "openai",
      url: "https://api.openai.com",
      token: "sk-test",
      models: ["gpt-5.2", "gpt-4o"],
    };
    const result = toDesktopProfile(p);
    expect(result.inferenceProvider).toBe("gateway");
    expect(result.inferenceModels).toEqual([
      { name: "claude-sonnet-4-6", supports1m: true },
      { name: "claude-opus-4-7", supports1m: true },
    ]);
    expect(result.inferenceModelMappings).toEqual([
      { alias: "claude-sonnet-4-6", actual: "gpt-5.2" },
      { alias: "claude-opus-4-7", actual: "gpt-4o" },
    ]);
    expect(result.inferenceGatewayBaseUrl).toBe("https://api.openai.com");
    expect(result.inferenceGatewayApiKey).toBe("sk-test");
    expect(result.inferenceGatewayAuthScheme).toBe("bearer");
  });

  it("maps up to 3 non-Anthropic models using available aliases", () => {
    const p: Profile = {
      provider: "openai",
      models: ["gpt-5.2", "gpt-5", "gpt-4o", "gpt-3.5-turbo"],
    };
    const result = toDesktopProfile(p);
    expect(result.inferenceModels).toEqual([
      { name: "claude-sonnet-4-6", supports1m: true },
      { name: "claude-opus-4-7", supports1m: true },
      { name: "claude-haiku-4-5-20251001", supports1m: true },
      { name: "claude-haiku-4-5-20251001", supports1m: true },
    ]);
    expect(result.inferenceModelMappings).toEqual([
      { alias: "claude-sonnet-4-6", actual: "gpt-5.2" },
      { alias: "claude-opus-4-7", actual: "gpt-5" },
      { alias: "claude-haiku-4-5-20251001", actual: "gpt-4o" },
      { alias: "claude-haiku-4-5-20251001", actual: "gpt-3.5-turbo" },
    ]);
  });

  it("only maps non-Anthropic models in mixed profiles", () => {
    const p: Profile = {
      provider: "openai",
      models: ["claude-sonnet-4-6", "gpt-5.2", "claude-opus-4-7", "gpt-4o"],
    };
    const result = toDesktopProfile(p);
    expect(result.inferenceModels).toEqual([
      { name: "claude-sonnet-4-6", supports1m: true },
      { name: "claude-opus-4-7", supports1m: true },
      { name: "claude-opus-4-7", supports1m: true },
      { name: "claude-haiku-4-5-20251001", supports1m: true },
    ]);
    expect(result.inferenceModelMappings).toEqual([
      { alias: "claude-opus-4-7", actual: "gpt-5.2" },
      { alias: "claude-haiku-4-5-20251001", actual: "gpt-4o" },
    ]);
  });

  it("treats provider without url as 1p even with non-Anthropic models", () => {
    const p: Profile = {
      provider: "anthropic",
      models: ["gpt-5.2"],
    };
    const result = toDesktopProfile(p);
    expect(result.inferenceProvider).toBe("1p");
    expect(result.inferenceModels).toEqual([{ name: "gpt-5.2", supports1m: true }]);
    expect(result.inferenceModelMappings).toBeUndefined();
  });

  it("defaults to gateway when provider is missing but url is present", () => {
    const p: Profile = {
      url: "https://api.example.com",
      model: "gpt-5.2",
    };
    const result = toDesktopProfile(p);
    expect(result.inferenceProvider).toBe("gateway");
    expect(result.inferenceModels).toEqual([{ name: "claude-sonnet-4-6", supports1m: true }]);
    expect(result.inferenceModelMappings).toEqual([{ alias: "claude-sonnet-4-6", actual: "gpt-5.2" }]);
  });

  it("handles empty models gracefully", () => {
    const p: Profile = { provider: "openai" };
    const result = toDesktopProfile(p);
    expect(result.inferenceModels).toEqual([]);
    expect(result.inferenceModelMappings).toBeUndefined();
  });
});
