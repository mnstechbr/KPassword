import { describe, expect, it } from "vitest";

import { collectVersions, evaluate } from "./version-check.mjs";

/**
 * Guard rail de consistencia de versao (auditoria Fase 4, achado MEDIUM-1).
 *
 * `evaluate` e pura, entao a divergencia e testada sem tocar em nenhum arquivo
 * do repositorio -- nada e modificado para simular falha.
 */

const src = (label, version, error = null) => ({ label, file: label, version, error });

describe("estado real do repositorio", () => {
  it("le as 7 fontes de versao", () => {
    const results = collectVersions();
    expect(results).toHaveLength(7);
    expect(results.every((r) => r.error === null)).toBe(true);
  });

  it("todas as fontes concordam neste momento", () => {
    const { ok, versions, problems } = evaluate(collectVersions());
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
    expect(versions).toHaveLength(1);
  });

  it("as fontes cobrem os arquivos esperados", () => {
    const files = new Set(collectVersions().map((r) => r.file));
    for (const f of [
      "package.json",
      "package-lock.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src/App.tsx",
    ]) {
      expect(files.has(f)).toBe(true);
    }
  });
});

describe("deteccao de divergencia (falha artificial)", () => {
  it("reprova quando uma fonte diverge", () => {
    const { ok, problems } = evaluate([
      src("package.json", "1.3.5"),
      src("tauri.conf.json", "1.3.5"),
      src("App.tsx", "1.3.6"), // divergente
    ]);
    expect(ok).toBe(false);
    expect(problems.join(" ")).toMatch(/divergencia entre fontes/);
    expect(problems.join(" ")).toMatch(/1\.3\.5 != 1\.3\.6/);
  });

  it("reprova quando uma fonte esta ilegivel", () => {
    const { ok, problems } = evaluate([
      src("package.json", "1.3.5"),
      src("Cargo.toml", null, "campo version nao encontrado"),
    ]);
    expect(ok).toBe(false);
    expect(problems.join(" ")).toMatch(/ilegivel/);
  });

  it("reprova versao que nao e semver", () => {
    const { ok, problems } = evaluate([src("package.json", "1.3")]);
    expect(ok).toBe(false);
    expect(problems.join(" ")).toMatch(/nao e semver/);
  });

  it("aceita pre-release e build metadata validos", () => {
    expect(evaluate([src("a", "1.3.5-rc.1"), src("b", "1.3.5-rc.1")]).ok).toBe(true);
  });

  it("reprova quando difere da versao esperada", () => {
    const { ok, problems } = evaluate([src("a", "1.3.5"), src("b", "1.3.5")], "1.3.6");
    expect(ok).toBe(false);
    expect(problems.join(" ")).toMatch(/esperado 1\.3\.6, encontrado 1\.3\.5/);
  });

  it("aprova quando bate com a versao esperada", () => {
    expect(evaluate([src("a", "1.3.5"), src("b", "1.3.5")], "1.3.5").ok).toBe(true);
  });

  it("uma unica divergencia entre sete fontes ja reprova", () => {
    const seis = Array.from({ length: 6 }, (_, i) => src(`f${i}`, "1.3.5"));
    expect(evaluate([...seis, src("f6", "1.3.4")]).ok).toBe(false);
  });
});
