#!/usr/bin/env node
/**
 * security:audit — auditoria local antes de uma release.
 *
 * Port em Node (somente stdlib) do antigo security-audit.ps1, para rodar
 * tanto no Windows quanto no Fedora. Executa, na ordem:
 *
 *   npm run build, cargo check, cargo test, npm audit   (qualquer falha aborta)
 *   cargo tree filtrado por quick-xml                     (informativo)
 *   cargo audit, se instalado                             (falha aborta)
 *
 * Uso:
 *   npm run security:audit
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { say } from "./release-cli.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(project, "src-tauri");

// No Windows, npm e cargo podem ser .cmd/.exe resolvidos pelo shell. Os
// comandos abaixo sao fixos; nenhum argumento vem do usuario.
const useShell = process.platform === "win32";

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, { cwd, shell: useShell, stdio: "inherit", ...options });
}

function step(title, command, args, cwd) {
  say("");
  say(`=== ${title} ===`, "cyan");
  const result = run(command, args, cwd);
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    say(`Falhou: ${title}`, "red");
    process.exit(result.status || 1);
  }
}

step("npm run build", "npm", ["run", "build"], project);
step("cargo check", "cargo", ["check"], tauriDir);
step("cargo test", "cargo", ["test"], tauriDir);
step("npm audit", "npm", ["audit"], project);

say("");
say("=== dependências Rust que usam quick-xml ===", "cyan");
const tree = run("cargo", ["tree"], tauriDir, {
  stdio: ["ignore", "pipe", "inherit"],
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
for (const line of String(tree.stdout ?? "").split(/\r?\n/)) {
  if (/quick-xml/i.test(line)) console.log(line);
}

say("");
say("=== cargo audit ===", "cyan");
const auditVersion = run("cargo", ["audit", "--version"], tauriDir, { stdio: "ignore" });
if (!auditVersion.error && auditVersion.status === 0) {
  const audit = run("cargo", ["audit"], tauriDir);
  if (audit.error || audit.status !== 0) {
    say("Falhou: cargo audit", "red");
    process.exit(audit.status || 1);
  }
} else {
  say("cargo audit não está instalado. Instale com: cargo install cargo-audit", "yellow");
}

say("");
say("Auditoria local concluída.", "green");
