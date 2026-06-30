const fs = require("fs");
const path = require("path");

const project = process.cwd();
const configPath = path.join(project, "src-tauri", "tauri.conf.json");

function readNoBom(filePath) {
  let buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.slice(3);
  }
  return buffer.toString("utf8");
}

function writeNoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

if (!fs.existsSync(configPath)) {
  throw new Error(`tauri.conf.json não encontrado: ${configPath}`);
}

const raw = readNoBom(configPath).trimStart();
const config = JSON.parse(raw);

config.bundle ??= {};
config.bundle.active = true;

config.bundle.icon = [
  "icons/32x32.png",
  "icons/64x64.png",
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

const backupPath = `${configPath}.backup-unique-icon-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(configPath, backupPath);
writeNoBom(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log("tauri.conf.json validado em UTF-8 sem BOM.");
console.log(`Backup criado: ${backupPath}`);
console.log("bundle.icon:");
console.log(config.bundle.icon);
console.log("bundle.windows.nsis:");
console.log(config.bundle.windows.nsis);
