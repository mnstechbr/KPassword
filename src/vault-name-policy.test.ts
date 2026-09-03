import { describe, expect, it } from "vitest";

import { createVaultSlug, validateNewVaultName } from "./vault-name-policy";

describe("createVaultSlug", () => {
  it("normaliza acentos e maiusculas", () => {
    expect(createVaultSlug("Cofre Pessoal")).toBe("cofre-pessoal");
    expect(createVaultSlug("Bóveda Ação")).toBe("boveda-acao");
  });

  it("colapsa separadores repetidos e apara as bordas", () => {
    expect(createVaultSlug("  --cofre   do  time--  ")).toBe("cofre-do-time");
  });

  it("preserva sublinhado e hifen", () => {
    expect(createVaultSlug("cofre_de-teste")).toBe("cofre_de-teste");
  });

  it("limita o slug a 48 caracteres", () => {
    expect(createVaultSlug("a".repeat(80))).toHaveLength(48);
  });

  it("devolve string vazia quando nao resta nada aproveitavel", () => {
    expect(createVaultSlug("")).toBe("");
    expect(createVaultSlug("   ")).toBe("");
    expect(createVaultSlug("!!!")).toBe("");
  });
});

describe("validateNewVaultName", () => {
  it("aceita um nome valido e devolve o slug", () => {
    expect(validateNewVaultName("Cofre Pessoal", [])).toEqual({ ok: true, slug: "cofre-pessoal" });
  });

  it("rejeita nome vazio", () => {
    expect(validateNewVaultName("", [])).toEqual({ ok: false, errorKey: "vault.invalidName" });
    expect(validateNewVaultName("   ", [])).toEqual({ ok: false, errorKey: "vault.invalidName" });
  });

  it("rejeita nome sem nenhum caractere aproveitavel", () => {
    expect(validateNewVaultName("!!!", [])).toEqual({ ok: false, errorKey: "vault.invalidName" });
  });

  it("rejeita cofre ja existente comparando pelo slug", () => {
    expect(validateNewVaultName("Cofre Pessoal", ["cofre-pessoal"])).toEqual({
      ok: false,
      errorKey: "vault.alreadyExists",
    });
  });

  it("nao confunde cofres com nomes parecidos", () => {
    expect(validateNewVaultName("Cofre Pessoal 2", ["cofre-pessoal"])).toEqual({
      ok: true,
      slug: "cofre-pessoal-2",
    });
  });

  // O backend (sanitize_vault_name, src-tauri/src/lib.rs) so aceita
  // [A-Za-z0-9_-] com no maximo 48 caracteres. Todo slug aprovado aqui
  // precisa passar por aquela regra sem virar erro.
  it("so aprova slugs que sanitize_vault_name aceitaria", () => {
    const candidatos = [
      "Cofre Pessoal",
      "Bóveda Ação",
      "cofre_de-teste",
      "a".repeat(80),
      "Trabalho / Casa",
      "cofre@2026!",
    ];

    for (const candidato of candidatos) {
      const resultado = validateNewVaultName(candidato, []);
      if (!resultado.ok) continue;

      expect(resultado.slug).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(resultado.slug.length).toBeLessThanOrEqual(48);
      expect(resultado.slug.trim()).toBe(resultado.slug);
    }
  });
});
