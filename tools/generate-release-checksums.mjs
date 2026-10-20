#!/usr/bin/env node
/**
 * release:hash — gera SHA256SUMS.txt para os assets publicos de uma pasta de
 * release (latest.json, KPassword*.exe e KPassword*.exe.sig).
 *
 * Port em Node (somente stdlib) do antigo generate-release-checksums.ps1, para
 * rodar tanto no Windows quanto no Fedora.
 *
 * Uso:
 *   npm run release:hash -- -ReleaseDir "./dist-release/v<versao>"
 *   node ./tools/generate-release-checksums.mjs --release-dir ./dist-release/v<versao>
 *
 * Falha (exit 1) se a pasta nao existir, se nao houver assets publicos ou se
 * houver arquivos sensiveis (.env, .key, .pem, cofres, backups...) na pasta.
 * Nesses casos nenhum SHA256SUMS.txt e gerado.
 */

import { writeFileSync } from "node:fs";
import { EOL } from "node:os";
import { join, resolve } from "node:path";
import {
  createReporter,
  findSensitiveFiles,
  isDirectory,
  isPublicAsset,
  listFiles,
  parseArgs,
  resolveDirArgument,
  say,
  sha256File,
} from "./release-cli.mjs";

const parsed = parseArgs(process.argv.slice(2), ["ReleaseDir"]);
if (parsed.error || !parsed.values.ReleaseDir) {
  console.error(parsed.error ?? "Informe a pasta de release.");
  console.error("Uso: node ./tools/generate-release-checksums.mjs -ReleaseDir <pasta>");
  process.exit(1);
}

const report = createReporter();

say("");
say("Geracao de SHA256SUMS do KPassword", "cyan");
say("");

const releaseDirArg = resolveDirArgument(parsed.values.ReleaseDir);
if (!isDirectory(releaseDirArg)) {
  report.error(`Pasta de release nao encontrada: ${parsed.values.ReleaseDir}`);
  say("");
  say(`Geracao falhou com ${report.errors.length} erro(s).`, "red");
  process.exit(1);
}

const releaseDir = resolve(releaseDirArg);
const releaseFiles = listFiles(releaseDir);
const outputPath = join(releaseDir, "SHA256SUMS.txt");

say(`Pasta: ${releaseDir}`);
say("");

const sensitiveFiles = findSensitiveFiles(releaseDir);
if (sensitiveFiles.length > 0) {
  report.error(`Arquivo sensivel encontrado na pasta de release: ${sensitiveFiles.join(", ")}`);
}

const publicAssets = releaseFiles.filter((file) => isPublicAsset(file.name));
if (publicAssets.length === 0) {
  report.error("Nenhum asset publico encontrado para gerar SHA256SUMS.txt.");
}

const skippedFiles = releaseFiles
  .filter((file) => file.fullPath !== outputPath && !isPublicAsset(file.name))
  .map((file) => file.name);
if (skippedFiles.length > 0) {
  report.warn(`Arquivos ignorados por nao serem assets publicos: ${skippedFiles.join(", ")}`);
}

if (report.errors.length > 0) {
  say("");
  say(
    `Geracao falhou com ${report.errors.length} erro(s). Nenhum SHA256SUMS.txt foi gerado.`,
    "red",
  );
  process.exit(1);
}

const lines = [];
for (const asset of publicAssets) {
  const hash = await sha256File(asset.fullPath);
  lines.push(`${hash}  ${asset.name}`);
  report.ok(`SHA256 calculado: ${asset.name}`);
}

// UTF-8 sem BOM, uma linha por asset, com a quebra de linha da plataforma.
writeFileSync(outputPath, lines.join(EOL) + EOL, { encoding: "utf8" });

say("");
say("SHA256SUMS.txt gerado:", "green");
say(outputPath);
say("");
say("Resumo:", "cyan");
say(`Assets incluidos: ${publicAssets.length}`);
say(`Avisos: ${report.warnings.length}`);
say("Erros: 0");
process.exit(0);
