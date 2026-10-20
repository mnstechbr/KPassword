import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * release:hash e release:validate rodam sem PowerShell (Windows e Fedora).
 * Cada teste monta uma pasta de release falsa em um diretorio temporario.
 */

const toolsDir = dirname(fileURLToPath(import.meta.url));
const VERSION = "9.8.7";
const INSTALLER = `KPassword-Setup-v${VERSION}.exe`;
const SIGNATURE = "dW50cnVzdGVkIGNvbW1lbnQ6IGZha2Ugc2lnbmF0dXJl";

const tempRoots = [];
afterEach(() => {
  while (tempRoots.length) rmSync(tempRoots.pop(), { recursive: true, force: true });
});

function fakeRelease({ folder = `v${VERSION}`, latest } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kpassword-release-"));
  tempRoots.push(root);
  const dir = join(root, folder);
  mkdirSync(dir);
  writeFileSync(join(dir, INSTALLER), "fake installer bytes");
  writeFileSync(join(dir, `${INSTALLER}.sig`), `${SIGNATURE}\n`);
  writeFileSync(
    join(dir, "latest.json"),
    JSON.stringify(
      latest ?? {
        version: VERSION,
        notes: "teste",
        pub_date: "2026-10-20T12:00:00Z",
        platforms: {
          "windows-x86_64": {
            signature: SIGNATURE,
            url: `https://github.com/mnstechbr/KPassword/releases/download/v${VERSION}/${INSTALLER}`,
          },
        },
      },
    ),
  );
  return dir;
}

function runTool(script, args) {
  const result = spawnSync(process.execPath, [join(toolsDir, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("generate-release-checksums.mjs", () => {
  it("gera SHA256SUMS.txt apenas com os assets publicos, em ordem", () => {
    const dir = fakeRelease();
    writeFileSync(join(dir, "notas.md"), "nao publico");

    const { status, output } = runTool("generate-release-checksums.mjs", ["-ReleaseDir", dir]);

    expect(status).toBe(0);
    expect(output).toContain("AVISO Arquivos ignorados por nao serem assets publicos: notas.md");
    const lines = readFileSync(join(dir, "SHA256SUMS.txt"), "utf8").trim().split(/\r?\n/);
    expect(lines).toEqual([
      `${sha256(join(dir, INSTALLER))}  ${INSTALLER}`,
      `${sha256(join(dir, `${INSTALLER}.sig`))}  ${INSTALLER}.sig`,
      `${sha256(join(dir, "latest.json"))}  latest.json`,
    ]);
  });

  it("recusa pasta com arquivo sensivel e nao gera nada", () => {
    const dir = fakeRelease();
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "updater.key"), "segredo");

    const { status, output } = runTool("generate-release-checksums.mjs", ["--release-dir", dir]);

    expect(status).toBe(1);
    expect(output).toMatch(/ERRO {2}Arquivo sensivel encontrado na pasta de release: sub[\\/]updater\.key/);
    expect(existsSync(join(dir, "SHA256SUMS.txt"))).toBe(false);
  });

  it("falha quando a pasta nao existe", () => {
    const { status, output } = runTool("generate-release-checksums.mjs", [
      join(tmpdir(), "kpassword-nao-existe-123456"),
    ]);
    expect(status).toBe(1);
    expect(output).toContain("Pasta de release nao encontrada");
  });
});

describe("validate-release-assets.mjs", () => {
  it("aprova uma release consistente com SHA256SUMS gerado", () => {
    const dir = fakeRelease();
    expect(runTool("generate-release-checksums.mjs", ["-ReleaseDir", dir]).status).toBe(0);

    const { status, output } = runTool("validate-release-assets.mjs", ["-ReleaseDir", dir]);

    expect(output).toContain(`OK    Versao esperada inferida pela pasta: v${VERSION}`);
    expect(output).toContain("OK    Assinatura do latest.json bate com o arquivo .sig.");
    expect(output).toContain(`OK    SHA256 confere para ${INSTALLER}.`);
    expect(output).toContain("Erros: 0");
    expect(status).toBe(0);
  });

  it("detecta hash adulterado, assinatura divergente e versao errada", () => {
    const dir = fakeRelease({
      latest: {
        version: "1.0.0",
        platforms: {
          "windows-x86_64": {
            signature: "outra-assinatura",
            url: `https://example.com/${INSTALLER}`,
          },
        },
      },
    });
    expect(runTool("generate-release-checksums.mjs", ["-ReleaseDir", dir]).status).toBe(0);
    writeFileSync(join(dir, INSTALLER), "instalador trocado depois do hash");

    const { status, output } = runTool("validate-release-assets.mjs", [
      "-ReleaseDir",
      dir,
      "-ExpectedVersion",
      `v${VERSION}`,
    ]);

    expect(status).toBe(1);
    expect(output).toContain(`ERRO  latest.json aponta para v1.0.0, mas o esperado e v${VERSION}.`);
    expect(output).toContain("ERRO  URL do latest.json nao aponta para github.com/mnstechbr/KPassword/releases/download/v9.8.7/");
    expect(output).toContain(`ERRO  Assinatura do latest.json nao bate com ${INSTALLER}.sig.`);
    expect(output).toContain(`ERRO  SHA256 nao confere para ${INSTALLER}.`);
    expect(output).toContain("AVISO latest.json nao possui pub_date.");
  });

  it("exige latest.json e o .sig do instalador", () => {
    const root = mkdtempSync(join(tmpdir(), "kpassword-release-"));
    tempRoots.push(root);
    const dir = join(root, `v${VERSION}`);
    mkdirSync(dir);
    writeFileSync(join(dir, INSTALLER), "x");

    const { status, output } = runTool("validate-release-assets.mjs", ["--ReleaseDir", dir]);

    expect(status).toBe(1);
    expect(output).toContain("ERRO  latest.json nao encontrado na pasta de release.");
    expect(output).toContain(`ERRO  Assinatura correspondente nao encontrada: ${INSTALLER}.sig`);
  });
});
