import { describe, expect, it } from "vitest";
import { translateBackendError, withBackendReason } from "./backend-errors";
import en from "./locales/en";
import es from "./locales/es";
import pt from "./locales/pt";
import tr from "./locales/tr";

describe("backend error codes", () => {
  it("translates a bare code", () => {
    expect(translateBackendError("error.storage.unavailable", "en")).toBe("Storage unavailable.");
    expect(translateBackendError("error.storage.unavailable", "es")).toBe("Almacenamiento no disponible.");
  });

  it("keeps the system detail after the translated message", () => {
    expect(translateBackendError("error.storage.createVaultDir: Permission denied (os error 13)", "pt"))
      .toBe("Erro ao criar a pasta do cofre. (Permission denied (os error 13))");
  });

  it("translates chained codes", () => {
    expect(translateBackendError("error.restore.aborted: error.storage.unavailable", "tr"))
      .toBe("Geri yükleme iptal edildi. Depolama kullanılamıyor.");
  });

  it("ignores errors that are not backend codes", () => {
    expect(translateBackendError(new Error("boom"), "en")).toBeUndefined();
    expect(translateBackendError("error.unknown.code", "en")).toBeUndefined();
    expect(translateBackendError(undefined, "en")).toBeUndefined();
  });

  it("appends the reason to the screen message", () => {
    expect(withBackendReason("Error saving the credential.", "error.clipboard.busy", "en"))
      .toBe("Error saving the credential. Clipboard in use by another app. Try copying again.");
    expect(withBackendReason("Error saving the credential.", new Error("x"), "en")).toBe("Error saving the credential.");
  });
});

describe("backend error catalogue", () => {
  it("has a message in every language for each code the backend returns", () => {
    const sources = Object.values(import.meta.glob<string>("../src-tauri/src/**/*.rs", { query: "?raw", import: "default", eager: true }));
    const codes = new Set(sources.flatMap((source) => [...source.matchAll(/"(error\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+)/g)].map((match) => match[1])));

    expect(codes.size).toBeGreaterThan(50);
    for (const [language, dictionary] of Object.entries({ pt, en, es, tr })) {
      for (const code of codes) expect(dictionary[code], `${language} ${code}`).toBeTruthy();
    }
  });
});
