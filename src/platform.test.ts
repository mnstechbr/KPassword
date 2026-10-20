import { describe, expect, it, vi, beforeEach } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { clearSecretClipboard, guessPlatform, linuxTranslation, writeSecretToClipboard } from "./platform";

describe("platform clipboard", () => {
  beforeEach(() => { invoke.mockReset(); });
  it("routes secrets through the native clipboard with the clear deadline", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await writeSecretToClipboard("fake-secret", 30);
    expect(invoke).toHaveBeenCalledWith("clipboard_write_secret", { value: "fake-secret", clearAfterSeconds: 30 });
  });
  it("does not silently fall back after native clipboard failure", async () => {
    invoke.mockRejectedValue(new Error("unavailable"));
    await expect(writeSecretToClipboard("fake-secret", 30)).rejects.toThrow("unavailable");
  });
  it("asks the backend to clear without surfacing errors", async () => {
    invoke.mockRejectedValue(new Error("unavailable"));
    expect(() => clearSecretClipboard()).not.toThrow();
    expect(invoke).toHaveBeenCalledWith("clipboard_clear_secret");
  });
  it("keeps untranslated Windows keys outside the Linux adaptations", () => {
    expect(linuxTranslation("credential.copyPassword", "pt")).toBeUndefined();
    expect(linuxTranslation("settings.startupWithWindows", "pt")).toContain("Linux");
  });
  it("guesses the platform from the webview user agent", () => {
    expect(guessPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120")).toBe("windows");
    expect(guessPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
    expect(guessPlatform("Mozilla/5.0 (Linux; Android 14)")).toBe("unknown");
  });
});
