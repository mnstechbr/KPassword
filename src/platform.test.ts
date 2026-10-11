import { describe, expect, it, vi, beforeEach } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { linuxTranslation, readClipboard, writeClipboard } from "./platform";

describe("platform clipboard", () => {
  beforeEach(() => { invoke.mockReset(); });
  it("routes Linux clipboard through native IPC", async () => {
    invoke.mockResolvedValueOnce("").mockResolvedValueOnce("fake-secret");
    await writeClipboard("fake-secret", true);
    expect(invoke).toHaveBeenNthCalledWith(1, "linux_clipboard", { value: "fake-secret" });
    expect(await readClipboard(true)).toBe("fake-secret");
  });
  it("does not silently fall back after native clipboard failure", async () => {
    invoke.mockRejectedValue(new Error("unavailable"));
    await expect(writeClipboard("fake-secret", true)).rejects.toThrow("unavailable");
  });
  it("keeps untranslated Windows keys outside the Linux adaptations", () => {
    expect(linuxTranslation("credential.copyPassword", "pt")).toBeUndefined();
    expect(linuxTranslation("settings.startupWithWindows", "pt")).toContain("Linux");
  });
});
