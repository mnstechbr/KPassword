import { describe, expect, it } from "vitest";
import { validSecretIdentifier, validateApiKey } from "./api-key";

describe("secret environment scope", () => {
  it("accepts provider-specific identifiers", () => {
    expect(validSecretIdentifier("ANTHROPIC_API_KEY")).toBe(true);
    expect(validSecretIdentifier("OPENAI_API_KEY")).toBe(true);
  });
  it.each(["PATH", "LD_PRELOAD", "NODE_OPTIONS", "BASH_ENV", "HOME", "A_API_KEY\n", "A=API_KEY", "A".repeat(70) + "_SECRET"])("rejects unsafe identifier %s", (name) => {
    expect(validSecretIdentifier(name)).toBe(false);
  });
  it("rejects empty, NUL and oversized secrets", () => {
    expect(validateApiKey(" ", "OPENAI_API_KEY")).not.toBeNull();
    expect(validateApiKey("fake\0key", "OPENAI_API_KEY")).not.toBeNull();
    expect(validateApiKey("a".repeat(16_385), "OPENAI_API_KEY")).not.toBeNull();
    expect(validateApiKey("fake-key", "OPENAI_API_KEY")).toBeNull();
  });
});
