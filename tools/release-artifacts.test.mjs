import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertSafeCleanupPath,
  isInstallerName,
  isSignatureName,
  releaseAssetNames,
  selectSignedInstaller,
} = require("./release-artifacts.cjs");

/**
 * Regressao do achado HIGH-2 da auditoria da Fase 4: a selecao da assinatura
 * era FAIL-OPEN (caia para "o .sig mais recente da pasta"). Estes testes
 * provam que a selecao passou a ser FAIL-CLOSED.
 *
 * Deterministicos: operam sobre listas de nomes, sem tocar no disco.
 */

const SETUP = "KPassword_1.3.5_x64-setup.exe";
const SIG = `${SETUP}.sig`;

describe("A — assinatura exata presente", () => {
  it("seleciona o par correto", () => {
    const r = selectSignedInstaller([SETUP, SIG, "outro.txt"]);
    expect(r).toEqual({ installer: SETUP, signature: SIG });
  });

  it("ignora arquivos irrelevantes do diretorio", () => {
    const r = selectSignedInstaller([SETUP, SIG, "nsis.log", "installer.nsi"]);
    expect(r.installer).toBe(SETUP);
  });
});

describe("B — assinatura exata ausente, outra .sig presente", () => {
  it("FALHA em vez de adotar a outra assinatura", () => {
    // Este e exatamente o cenario que o codigo antigo aceitava.
    expect(() =>
      selectSignedInstaller([SETUP, "KPassword_1.3.4_x64-setup.exe.sig"]),
    ).toThrow(/Assinatura esperada nao encontrada/);
  });

  it("a mensagem nomeia o arquivo esperado e as assinaturas presentes", () => {
    let msg = "";
    try {
      selectSignedInstaller([SETUP, "antiga.sig"], "bundle/nsis");
    } catch (e) {
      msg = String(e.message);
    }
    expect(msg).toContain(SIG);
    expect(msg).toContain("antiga.sig");
    expect(msg).toContain("bundle/nsis");
  });

  it("a mensagem nao revela caminho de chave nem segredo", () => {
    let msg = "";
    try {
      selectSignedInstaller([SETUP, "antiga.sig"]);
    } catch (e) {
      msg = String(e.message);
    }
    // Cuidado: "KPassword" contem "password"; procuramos indicadores REAIS de
    // segredo -- caminho da chave, nome de arquivo de chave e valor de env var.
    expect(msg).not.toMatch(/\.tauri[\\/]/i);
    expect(msg).not.toMatch(/\.key\b/i);
    expect(msg).not.toMatch(/TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?\s*=/i);
    expect(msg).not.toMatch(/untrusted comment|RWR[A-Za-z0-9+/]{10}/); // material minisign
  });
});

describe("C — multiplas .sig antigas sem a exata", () => {
  it("FALHA mesmo com varias assinaturas disponiveis", () => {
    expect(() =>
      selectSignedInstaller([SETUP, "a.sig", "b.sig", "c.sig"]),
    ).toThrow(/Assinatura esperada nao encontrada/);
  });

  it("FALHA tambem quando ha mais de um instalador", () => {
    expect(() =>
      selectSignedInstaller([SETUP, SIG, "KPassword_1.3.4_x64-setup.exe"]),
    ).toThrow(/Mais de um instalador/);
  });

  it("nunca resolve ambiguidade por data — a API nem recebe datas", () => {
    // Garante que a assinatura da funcao nao aceita metadados de tempo.
    expect(selectSignedInstaller.length).toBeLessThanOrEqual(2);
  });
});

describe("D — casos degenerados", () => {
  it("FALHA quando nao ha instalador", () => {
    expect(() => selectSignedInstaller(["latest.json", "a.sig"])).toThrow(
      /Nenhum instalador/,
    );
  });

  it("FALHA em diretorio vazio", () => {
    expect(() => selectSignedInstaller([])).toThrow(/Nenhum instalador/);
  });

  it("FALHA quando ha instalador mas nenhuma assinatura", () => {
    expect(() => selectSignedInstaller([SETUP])).toThrow(
      /Assinatura esperada nao encontrada/,
    );
  });
});

describe("reconhecimento de nomes", () => {
  it("identifica instaladores e assinaturas", () => {
    expect(isInstallerName(SETUP)).toBe(true);
    expect(isInstallerName("KPassword.exe")).toBe(false); // sem "setup"
    expect(isInstallerName("leia-me.txt")).toBe(false);
    expect(isSignatureName(SIG)).toBe(true);
    expect(isSignatureName(SETUP)).toBe(false);
  });
});

describe("limpeza segura do diretorio de bundle", () => {
  const ROOT = "C:/Projetos/KPassword";
  const SUFFIX = "src-tauri/target/release/bundle";

  it("aceita o alvo esperado", () => {
    expect(assertSafeCleanupPath(ROOT, `${ROOT}/${SUFFIX}`, SUFFIX)).toBe(true);
  });

  it("aceita separadores do Windows", () => {
    expect(
      assertSafeCleanupPath(ROOT, "C:\\Projetos\\KPassword\\src-tauri\\target\\release\\bundle", SUFFIX),
    ).toBe(true);
  });

  it("recusa alvo fora da raiz do projeto", () => {
    expect(() => assertSafeCleanupPath(ROOT, `C:/Outro/${SUFFIX}`, SUFFIX)).toThrow(/fora da raiz/);
  });

  it("recusa alvo com sufixo inesperado", () => {
    expect(() => assertSafeCleanupPath(ROOT, `${ROOT}/src`, SUFFIX)).toThrow(/nao termina/);
  });

  it("recusa a propria raiz", () => {
    expect(() => assertSafeCleanupPath(ROOT, ROOT, SUFFIX)).toThrow();
  });

  it("recusa alvo raso demais", () => {
    expect(() => assertSafeCleanupPath(ROOT, `${ROOT}/bundle`, "bundle")).toThrow(/raso/);
  });
});

describe("lista canonica de assets", () => {
  it("inclui SHA256SUMS.txt", () => {
    // A auditoria encontrou SHA256SUMS.txt publicado mas ausente das
    // instrucoes de upload. A lista canonica agora e uma so.
    const assets = releaseAssetNames("1.3.5");
    expect(assets).toEqual([
      "KPassword-Setup-v1.3.5.exe",
      "KPassword-Setup-v1.3.5.exe.sig",
      "latest.json",
      "SHA256SUMS.txt",
    ]);
  });
});
