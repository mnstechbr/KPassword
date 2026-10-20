#!/usr/bin/env node
/**
 * release:validate — confere a pasta local de release antes de anexar os
 * arquivos no GitHub: instalador, .sig, latest.json, SHA256SUMS e ausencia de
 * arquivos sensiveis.
 *
 * Port em Node (somente stdlib) do antigo validate-release-assets.ps1, para
 * rodar tanto no Windows quanto no Fedora. Mensagens e regras sao as mesmas.
 *
 * Uso:
 *   npm run release:validate -- -ReleaseDir "./dist-release/v<versao>"
 *   npm run release:validate -- -ReleaseDir <pasta> -ExpectedVersion <versao>
 *
 *   exit 0 -> sem ERROs (AVISOs nao bloqueiam)
 *   exit 1 -> pelo menos um ERRO
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  createReporter,
  findSensitiveFiles,
  isDirectory,
  listFiles,
  parseArgs,
  resolveDirArgument,
  say,
  sha256File,
} from "./release-cli.mjs";

const parsed = parseArgs(process.argv.slice(2), ["ReleaseDir", "ExpectedVersion"]);
if (parsed.error || !parsed.values.ReleaseDir) {
  console.error(parsed.error ?? "Informe a pasta de release.");
  console.error(
    "Uso: node ./tools/validate-release-assets.mjs -ReleaseDir <pasta> [-ExpectedVersion <versao>]",
  );
  process.exit(1);
}

const report = createReporter();
const { ok } = report;
const error = report.error;
const warn = report.warn;

const lower = (value) => String(value).toLowerCase();
const sameText = (a, b) => lower(a) === lower(b);
const containsText = (haystack, needle) => lower(haystack).includes(lower(needle));
const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";
const normalizeVersion = (value) => String(value ?? "").trim().replace(/^[vV]/, "");
const readText = (path) => readFileSync(path, "utf8").replace(/^﻿/, "");
/** Nome do arquivo aceitando separadores "/" e "\\". */
const fileNameOf = (value) => String(value).split(/[\\/]/).pop();

/** Truthiness do PowerShell para valores vindos de JSON. */
function truthy(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Acesso a propriedade sem diferenciar maiusculas, como no ConvertFrom-Json. */
function prop(object, name) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return undefined;
  if (Object.hasOwn(object, name)) return object[name];
  const match = Object.keys(object).find((key) => sameText(key, name));
  return match === undefined ? undefined : object[match];
}

/** [string]$valor do PowerShell: nulo vira "". */
const asString = (value) => (value === undefined || value === null ? "" : String(value));

function fileNameFromUrl(url) {
  if (isBlank(url)) return "";
  try {
    const name = basename(new URL(url).pathname);
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  } catch {
    return fileNameOf(url);
  }
}

say("");
say("Validacao de assets de release do KPassword", "cyan");
say("");

const releaseDirArg = resolveDirArgument(parsed.values.ReleaseDir);
if (!isDirectory(releaseDirArg)) {
  error(`Pasta de release nao encontrada: ${parsed.values.ReleaseDir}`);
  say("");
  say(`Validacao falhou com ${report.errors.length} erro(s).`, "red");
  process.exit(1);
}

const releaseDir = resolve(releaseDirArg);
const releaseFiles = listFiles(releaseDir);

say(`Pasta: ${releaseDir}`);
say("");

let expectedVersion = asString(parsed.values.ExpectedVersion);
const versionPattern = /^v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/i;
const folderVersion = versionPattern.exec(basename(releaseDir));
if (!isBlank(expectedVersion)) {
  expectedVersion = normalizeVersion(expectedVersion);
  ok(`Versao esperada informada: v${expectedVersion}`);
} else if (folderVersion) {
  expectedVersion = normalizeVersion(folderVersion[1]);
  ok(`Versao esperada inferida pela pasta: v${expectedVersion}`);
} else {
  warn("Versao esperada nao informada e nome da pasta nao segue o padrao vX.Y.Z.");
}

// --- latest.json ------------------------------------------------------------
const latestJsonFile = releaseFiles.find((file) => sameText(file.name, "latest.json"));
let latestJson = null;
if (latestJsonFile) {
  ok("latest.json encontrado.");
  try {
    latestJson = JSON.parse(readText(latestJsonFile.fullPath));
  } catch (cause) {
    error(`latest.json nao e JSON valido: ${cause.message}`);
    latestJson = null;
  }
  if (truthy(latestJson)) {
    ok("latest.json e JSON valido.");
  }
} else {
  error("latest.json nao encontrado na pasta de release.");
}

if (isBlank(expectedVersion) && truthy(latestJson) && truthy(prop(latestJson, "version"))) {
  expectedVersion = normalizeVersion(prop(latestJson, "version"));
  warn(
    `Versao esperada inferida pelo latest.json: v${expectedVersion}. Prefira usar uma pasta vX.Y.Z ou -ExpectedVersion.`,
  );
}

// --- Instalador ---------------------------------------------------------------
const exeFiles = releaseFiles.filter((file) => lower(file.name).endsWith(".exe"));
const installerCandidates = exeFiles.filter((file) => /^KPassword.*\.exe$/i.test(file.name));
let installer = null;

if (exeFiles.length === 0) {
  error("Nenhum instalador .exe encontrado.");
} else if (installerCandidates.length === 0) {
  error(
    `Nenhum .exe do KPassword encontrado. Arquivos .exe detectados: ${exeFiles.map((file) => file.name).join(", ")}`,
  );
} else {
  if (!isBlank(expectedVersion)) {
    installer = installerCandidates.find((file) => containsText(file.name, expectedVersion)) ?? null;
  }
  if (!installer) {
    installer = [...installerCandidates].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  }

  ok(`Instalador encontrado: ${installer.name}`);

  if (installerCandidates.length > 1) {
    warn(
      `Mais de um instalador KPassword encontrado: ${installerCandidates.map((file) => file.name).join(", ")}. Validando ${installer.name}.`,
    );
  }
}

if (installer && !isBlank(expectedVersion)) {
  if (containsText(installer.name, expectedVersion)) {
    ok(`Nome do instalador contem a versao esperada v${expectedVersion}.`);
  } else {
    error(`Nome do instalador nao contem a versao esperada v${expectedVersion}: ${installer.name}`);
  }

  const expectedInstallerName = `KPassword-Setup-v${expectedVersion}.exe`;
  if (installer.name !== expectedInstallerName) {
    warn(`Nome do instalador difere do padrao atual ${expectedInstallerName}.`);
  } else {
    ok("Nome do instalador segue o padrao atual.");
  }
}

let sigFile = null;
if (installer) {
  const expectedSigName = `${installer.name}.sig`;
  sigFile = releaseFiles.find((file) => file.name === expectedSigName) ?? null;
  if (sigFile) {
    ok(`Assinatura correspondente encontrada: ${sigFile.name}`);
  } else {
    error(`Assinatura correspondente nao encontrada: ${expectedSigName}`);
  }
}

// --- Conteudo do latest.json -------------------------------------------------
if (truthy(latestJson)) {
  const version = prop(latestJson, "version");
  if (truthy(version)) {
    const latestVersion = normalizeVersion(version);
    if (!isBlank(expectedVersion)) {
      if (sameText(latestVersion, expectedVersion)) {
        ok(`latest.json aponta para a versao esperada v${expectedVersion}.`);
      } else {
        error(`latest.json aponta para v${latestVersion}, mas o esperado e v${expectedVersion}.`);
      }
    } else {
      ok(`latest.json informa versao v${latestVersion}.`);
    }
  } else {
    error("latest.json nao possui campo version.");
  }

  const pubDate = prop(latestJson, "pub_date");
  if (truthy(pubDate)) {
    if (Number.isNaN(Date.parse(String(pubDate)))) {
      warn("latest.json possui pub_date, mas ele nao parece uma data valida.");
    } else {
      ok("latest.json possui pub_date valido.");
    }
  } else {
    warn("latest.json nao possui pub_date.");
  }

  let windowsPlatform = null;
  const platforms = prop(latestJson, "platforms");
  if (truthy(platforms)) {
    const platform = prop(platforms, "windows-x86_64");
    if (platform !== undefined) {
      windowsPlatform = platform;
      ok("latest.json possui plataforma windows-x86_64.");
    } else {
      error("latest.json nao possui platforms.windows-x86_64.");
    }
  } else {
    error("latest.json nao possui platforms.");
  }

  if (truthy(windowsPlatform)) {
    const updaterUrl = asString(prop(windowsPlatform, "url"));
    if (isBlank(updaterUrl)) {
      error("latest.json nao possui URL do instalador em platforms.windows-x86_64.url.");
    } else {
      const urlFileName = fileNameFromUrl(updaterUrl);
      if (installer && sameText(urlFileName, installer.name)) {
        ok("URL do latest.json aponta para o asset do instalador.");
      } else if (installer) {
        error(
          `URL do latest.json aponta para '${urlFileName}', mas o instalador local e '${installer.name}'.`,
        );
      }

      if (!isBlank(expectedVersion)) {
        const expectedReleasePath = `/mnstechbr/KPassword/releases/download/v${expectedVersion}/`;
        let uri = null;
        try {
          uri = new URL(updaterUrl);
        } catch {
          error(`URL do latest.json nao e uma URL valida: ${updaterUrl}`);
        }
        if (uri) {
          const hostIsGitHub = sameText(uri.hostname, "github.com");
          const pathMatches = containsText(uri.pathname, expectedReleasePath);
          if (hostIsGitHub && pathMatches) {
            ok(`URL do latest.json usa o release GitHub esperado v${expectedVersion}.`);
          } else {
            error(`URL do latest.json nao aponta para github.com${expectedReleasePath}`);
          }
        }
      }
    }

    const latestSignature = asString(prop(windowsPlatform, "signature")).trim();
    if (isBlank(latestSignature)) {
      error("latest.json nao possui assinatura em platforms.windows-x86_64.signature.");
    } else if (sigFile) {
      const sigContent = readText(sigFile.fullPath).trim();
      // Comparacao exata: a assinatura e base64, maiusculas importam.
      if (latestSignature === sigContent) {
        ok("Assinatura do latest.json bate com o arquivo .sig.");
      } else {
        error(`Assinatura do latest.json nao bate com ${sigFile.name}.`);
      }
    }
  }
}

// --- SHA256SUMS ---------------------------------------------------------------
const hashFiles = releaseFiles.filter((file) => /^SHA256(SUMS)?(\.txt)?$/i.test(file.name));
if (hashFiles.length === 0) {
  warn("Arquivo SHA256/SHA256SUMS nao encontrado. Hash externo e opcional, mas nao foi conferido.");
} else {
  const filesByLongestName = [...releaseFiles].sort((a, b) => b.name.length - a.name.length);

  for (const hashFile of hashFiles) {
    ok(`Arquivo de hash encontrado: ${hashFile.name}`);
    let validHashLines = 0;
    const lines = readText(hashFile.fullPath).split(/\r\n|\n|\r/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) continue;

      let expectedHash;
      let hashTargetName = "";
      const named = /^\s*([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
      if (named) {
        expectedHash = named[1].toLowerCase();
        hashTargetName = fileNameOf(named[2].trim().replace(/^"+|"+$/g, ""));
      } else {
        const bare = /\b([a-f0-9]{64})\b/i.exec(line);
        if (!bare) {
          error(`Linha de hash invalida em ${hashFile.name}: ${line}`);
          continue;
        }
        expectedHash = bare[1].toLowerCase();
      }

      let targetFile = null;
      if (hashTargetName !== "") {
        targetFile =
          releaseFiles.find(
            (file) => sameText(file.name, hashTargetName) && file.fullPath !== hashFile.fullPath,
          ) ?? null;
      } else {
        targetFile =
          filesByLongestName.find(
            (file) => file.fullPath !== hashFile.fullPath && containsText(line, file.name),
          ) ?? null;
      }

      if (!targetFile && installer && hashFiles.length === 1) {
        targetFile = installer;
      }

      if (!targetFile) {
        error(`Nao foi possivel identificar o arquivo da linha de hash em ${hashFile.name}: ${line}`);
        continue;
      }

      const actualHash = await sha256File(targetFile.fullPath);
      if (actualHash === expectedHash) {
        ok(`SHA256 confere para ${targetFile.name}.`);
        validHashLines += 1;
      } else {
        error(
          `SHA256 nao confere para ${targetFile.name}. Esperado ${expectedHash}, obtido ${actualHash}.`,
        );
      }
    }

    if (validHashLines === 0) {
      error(`Nenhuma linha de hash valida foi conferida em ${hashFile.name}.`);
    }
  }
}

// --- Arquivos sensiveis e extras -----------------------------------------------
const sensitiveFiles = findSensitiveFiles(releaseDir);
if (sensitiveFiles.length > 0) {
  error(`Arquivo sensivel encontrado na pasta de release: ${sensitiveFiles.join(", ")}`);
} else {
  ok("Nenhum arquivo sensivel encontrado na pasta de release.");
}

const knownAssetNames = new Set(
  ["latest.json", "UPLOAD_THESE_FILES.txt", "UPLOAD_NO_GITHUB.txt"].map(lower),
);
for (const hashFile of hashFiles) knownAssetNames.add(lower(hashFile.name));
if (installer) {
  knownAssetNames.add(lower(installer.name));
  knownAssetNames.add(lower(`${installer.name}.sig`));
}

const extraFiles = releaseFiles.filter((file) => !knownAssetNames.has(lower(file.name)));
if (extraFiles.length > 0) {
  warn(
    `Arquivos extras na pasta de release: ${extraFiles.map((file) => file.name).join(", ")}. Confirme que nao serao anexados por engano.`,
  );
}

say("");
say("Resumo:", "cyan");
say("OK/AVISO/ERRO emitidos acima.");
say(`Erros: ${report.errors.length}`);
say(`Avisos: ${report.warnings.length}`);

if (report.errors.length > 0) {
  say("");
  say("Validacao falhou. Corrija os ERROs antes de publicar a release.", "red");
  process.exit(1);
}

say("");
say(
  "Validacao concluida com sucesso. Avisos nao bloqueiam a release, mas devem ser revisados.",
  "green",
);
process.exit(0);
