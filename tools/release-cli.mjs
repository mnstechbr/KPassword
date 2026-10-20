/**
 * Helpers compartilhados pelos scripts de release em Node
 * (generate-release-checksums.mjs e validate-release-assets.mjs).
 *
 * Somente stdlib do Node: os scripts rodam em Windows e no Fedora sem
 * PowerShell e sem `npm install`.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const COLORS = { red: 31, green: 32, yellow: 33, cyan: 36 };

/** Equivalente a `Write-Host -ForegroundColor`. */
export function say(message = "", color) {
  if (color && useColor) {
    console.log(`\x1b[${COLORS[color]}m${message}\x1b[0m`);
  } else {
    console.log(message);
  }
}

/** Acumula ERRO/AVISO com a mesma saida dos antigos scripts PowerShell. */
export function createReporter() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    ok(message) {
      say(`OK    ${message}`, "green");
    },
    error(message) {
      errors.push(message);
      say(`ERRO  ${message}`, "red");
    },
    warn(message) {
      warnings.push(message);
      say(`AVISO ${message}`, "yellow");
    },
  };
}

/**
 * Le parametros no estilo dos antigos scripts PowerShell, para que os comandos
 * documentados continuem funcionando:
 *
 *   -ReleaseDir X | --ReleaseDir X | --release-dir X | --release-dir=X | X
 *
 * `spec` lista os nomes na ordem posicional, por exemplo
 * ["ReleaseDir", "ExpectedVersion"]. Retorna { values } ou { error }.
 */
export function parseArgs(argv, spec) {
  const key = (name) => name.replace(/-/g, "").toLowerCase();
  const known = new Map(spec.map((name) => [key(name), name]));
  const values = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const option = /^--?([A-Za-z][A-Za-z-]*)(?:=(.*))?$/s.exec(arg);
    if (!option) {
      positional.push(arg);
      continue;
    }
    const name = known.get(key(option[1]));
    if (!name) {
      return { error: `Parametro desconhecido: ${arg}` };
    }
    if (option[2] !== undefined) {
      values[name] = option[2];
    } else if (index + 1 < argv.length) {
      values[name] = argv[index + 1];
      index += 1;
    } else {
      return { error: `Parametro sem valor: ${arg}` };
    }
  }

  for (const name of spec) {
    if (values[name] === undefined && positional.length > 0) {
      values[name] = positional.shift();
    }
  }
  if (positional.length > 0) {
    return { error: `Argumento inesperado: ${positional[0]}` };
  }
  return { values };
}

/**
 * Os checklists usam caminhos no estilo Windows (".\dist-release\v1.2.3").
 * Fora do Windows, se o caminho literal nao existir, tenta com "/".
 */
export function resolveDirArgument(value) {
  if (process.platform !== "win32" && value.includes("\\") && !existsSync(value)) {
    return value.replace(/\\/g, "/");
  }
  return value;
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Ordem estavel e sem diferenciar maiusculas, como o Get-ChildItem no NTFS. */
export function byName(a, b) {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Arquivos diretamente na pasta (Get-ChildItem -File). */
export function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      files.push({ name: entry.name, fullPath, mtimeMs: stat.mtimeMs });
    }
  }
  return files.sort(byName);
}

/**
 * Arquivos em todas as subpastas (Get-ChildItem -File -Recurse). Links
 * simbolicos para pastas nao sao seguidos, como no PowerShell.
 */
export function listFilesRecursive(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isFile()) {
        files.push({ name: entry.name, fullPath });
      }
    }
  };
  walk(dir);
  return files;
}

const SENSITIVE_PATTERN =
  /(^|[\\/])\.env($|[\\/])|\.env($|\.)|\.key$|\.pem$|private|secret|token|backup|\.kpvault$|\.kphello$/i;

/** Caminhos relativos de arquivos que nunca devem ir para uma release. */
export function findSensitiveFiles(releaseDir) {
  return listFilesRecursive(releaseDir)
    .map((file) => relative(releaseDir, file.fullPath))
    .filter((relativePath) => SENSITIVE_PATTERN.test(relativePath));
}

/** Assets publicos: latest.json, instalador KPassword*.exe e seu .sig. */
export function isPublicAsset(name) {
  return (
    name.toLowerCase() === "latest.json" ||
    /^KPassword.*\.exe$/i.test(name) ||
    /^KPassword.*\.exe\.sig$/i.test(name)
  );
}

/** SHA-256 em hexadecimal minusculo, lendo o arquivo em streaming. */
export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}
