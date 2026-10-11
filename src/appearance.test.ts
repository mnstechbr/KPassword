import { describe, expect, it } from "vitest";
import { normalizeTheme, readAppearance, resolveTheme } from "./appearance";

describe("appearance migration and system preferences", () => {
  it("preserves explicit themes and migrates mixed/unknown profiles to system", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    for (const value of ["mixed", "system", "invalid", null]) expect(normalizeTheme(value)).toBe("system");
  });
  it("only follows OS color changes when system is selected", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("keeps accessibility and density preferences when migrating a profile", () => {
    const values: Record<string, string> = { "kpassword:theme": "mixed", "kpassword:font-scale": "large", "kpassword:reduce-motion": "true", "kpassword:compact-mode": "true" };
    expect(readAppearance({ getItem: (key) => values[key] ?? null })).toEqual({ theme: "system", fontScale: "large", reduceMotion: true, compactMode: true });
  });
});
