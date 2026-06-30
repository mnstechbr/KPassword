const fs = require("fs");
const path = require("path");

const project = process.cwd();
const configPath = path.join(project, "src-tauri", "tauri.conf.json");
const iconPath = path.join(project, "src-tauri", "icons", "icon.ico");

function readUtf8NoBom(filePath) {
  let buffer = fs.readFileSync(filePath);

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.slice(3);
  }

  return buffer.toString("utf8");
}

function writeUtf8NoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function findLatestBackup() {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.backup`))
    .map((name) => {
      const full = path.join(dir, name);
      return {
        name,
        full,
        mtimeMs: fs.statSync(full).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files[0] ?? null;
}

function parseConfigOrRestore() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`tauri.conf.json não encontrado em ${configPath}`);
  }

  const raw = readUtf8NoBom(configPath).trimStart();

  try {
    return JSON.parse(raw);
  } catch (firstError) {
    const latestBackup = findLatestBackup();

    if (!latestBackup) {
      throw new Error(
        `tauri.conf.json está inválido e nenhum backup foi encontrado. Erro original: ${firstError.message}`,
      );
    }

    console.log(`tauri.conf.json inválido. Restaurando backup: ${latestBackup.name}`);
    const backupRaw = readUtf8NoBom(latestBackup.full).trimStart();

    try {
      const restored = JSON.parse(backupRaw);
      writeUtf8NoBom(configPath, `${JSON.stringify(restored, null, 2)}\n`);
      return restored;
    } catch (backupError) {
      throw new Error(
        `Backup mais recente também está inválido: ${latestBackup.full}. Erro: ${backupError.message}`,
      );
    }
  }
}

if (!fs.existsSync(iconPath)) {
  console.log("Aviso: src-tauri/icons/icon.ico ainda não existe. O comando npm run tauri icon app-icon.png será executado depois.");
}

const config = parseConfigOrRestore();

config.bundle ??= {};
config.bundle.active = true;
config.bundle.icon = [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico",
];

config.bundle.windows ??= {};
config.bundle.windows.nsis ??= {};
config.bundle.windows.nsis.installerIcon = "icons/icon.ico";
config.bundle.windows.nsis.uninstallerIcon = "icons/icon.ico";
config.bundle.windows.nsis.installMode ??= "currentUser";

const backupPath = `${configPath}.backup-node-icon-${new Date()
  .toISOString()
  .replace(/[:.]/g, "-")}`;

fs.copyFileSync(configPath, backupPath);
writeUtf8NoBom(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log("tauri.conf.json corrigido e salvo em UTF-8 sem BOM.");
console.log(`Backup criado: ${backupPath}`);
console.log('NSIS installerIcon configurado: "icons/icon.ico"');
console.log('NSIS uninstallerIcon configurado: "icons/icon.ico"');
