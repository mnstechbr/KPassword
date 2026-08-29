#!/usr/bin/env node
/**
 * version:check — guard rail READ-ONLY de consistencia de versao.
 *
 * A auditoria da Fase 4 encontrou SETE fontes de versao, todas atualizadas a
 * mao, sem nenhuma verificacao. Uma divergencia entre `tauri.conf.json` e
 * `APP_VERSION` produziria um app que se reporta com a versao errada ao
 * updater -- e ninguem perceberia ate a release estar publicada.
 *
 * Este script NAO corrige nada. Ele apenas le, compara e falha.
 *
 *   exit 0  -> todas as fontes concordam
 *   exit 1  -> divergencia, fonte ausente ou ilegivel
 *
 * Uso:
 *   npm run version:check
 *   npm run version:check -- --expected 1.3.6
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Raiz do repositorio derivada da localizacao DESTE arquivo (tools/..). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const expectedIndex = args.indexOf("--expected");
const expected = expectedIndex >= 0 ? args[expectedIndex + 1] : null;

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function read(relative) {
  return readFileSync(join(repoRoot, relative), "utf8");
}

/** Cada fonte devolve { file, label, version } ou lanca. */
const SOURCES = [
  {
    file: "package.json",
    label: "package.json → version",
    read: () => JSON.parse(read("package.json")).version,
  },
  {
    file: "package-lock.json",
    label: "package-lock.json → version",
    read: () => JSON.parse(read("package-lock.json")).version,
  },
  {
    file: "package-lock.json",
    label: 'package-lock.json → packages[""].version',
    read: () => JSON.parse(read("package-lock.json")).packages[""].version,
  },
  {
    file: "src-tauri/tauri.conf.json",
    label: "tauri.conf.json → version",
    // O arquivo ja teve BOM no passado; removemos antes de parsear.
    read: () => JSON.parse(read("src-tauri/tauri.conf.json").replace(/^﻿/, "")).version,
  },
  {
    file: "src-tauri/Cargo.toml",
    label: "Cargo.toml → [package] version",
    read: () => {
      const m = read("src-tauri/Cargo.toml").match(/^\s*version\s*=\s*"([^"]+)"/m);
      if (!m) throw new Error("campo version nao encontrado em [package]");
      return m[1];
    },
  },
  {
    file: "src-tauri/Cargo.lock",
    label: 'Cargo.lock → name = "kpassword"',
    read: () => {
      const m = read("src-tauri/Cargo.lock").match(
        /name\s*=\s*"kpassword"\s*\nversion\s*=\s*"([^"]+)"/,
      );
      if (!m) throw new Error('entrada name = "kpassword" nao encontrada');
      return m[1];
    },
  },
  {
    file: "src/App.tsx",
    label: "App.tsx → APP_VERSION",
    read: () => {
      const m = read("src/App.tsx").match(/const\s+APP_VERSION\s*=\s*"([^"]+)"/);
      if (!m) throw new Error("constante APP_VERSION nao encontrada");
      return m[1];
    },
  },
];

/** Le todas as fontes. Exportado para teste. */
export function collectVersions(sources = SOURCES) {
  return sources.map((source) => {
    try {
      const version = source.read();
      return { label: source.label, file: source.file, version, error: null };
    } catch (error) {
      return { label: source.label, file: source.file, version: null, error: String(error.message ?? error) };
    }
  });
}

/**
 * Decide o resultado a partir das versoes lidas. Funcao pura, testavel.
 * @returns {{ ok: boolean, versions: string[], problems: string[] }}
 */
export function evaluate(results, expectedVersion = null) {
  const problems = [];

  for (const r of results) {
    if (r.error) problems.push(`${r.label}: ilegivel — ${r.error}`);
    else if (!SEMVER.test(r.version)) problems.push(`${r.label}: "${r.version}" nao e semver valido`);
  }

  const versions = [...new Set(results.filter((r) => r.version).map((r) => r.version))];

  if (versions.length > 1) {
    problems.push(`divergencia entre fontes: ${versions.sort().join(" != ")}`);
  }

  if (expectedVersion && versions.length === 1 && versions[0] !== expectedVersion) {
    problems.push(`esperado ${expectedVersion}, encontrado ${versions[0]}`);
  }

  return { ok: problems.length === 0, versions, problems };
}

function main() {
  const results = collectVersions();
  const width = Math.max(...results.map((r) => r.label.length));

  console.log("");
  console.log("Consistencia de versao do KPassword");
  console.log("");
  for (const r of results) {
    console.log(`  ${r.label.padEnd(width)}  ${r.version ?? "(ILEGIVEL)"}`);
  }
  console.log("");

  const { ok, versions, problems } = evaluate(results, expected);

  if (ok) {
    console.log(`OK  ${results.length} fontes concordam em ${versions[0]}`);
    console.log("");
    process.exit(0);
  }

  for (const p of problems) console.error(`ERRO  ${p}`);
  console.error("");
  console.error("Nenhuma correcao automatica e feita: ajuste as fontes divergentes a mao.");
  console.error("");
  process.exit(1);
}

// Só executa quando invocado diretamente, nunca ao ser importado por teste.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
