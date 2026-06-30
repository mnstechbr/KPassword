const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const owner = getArg("owner");
const repo = getArg("repo");
const version = getArg("version", "0.3.0");
const notes = getArg("notes", "Atualização do KPassword.");

if (!owner || !repo) throw new Error("Informe --owner e --repo.");

const project = process.cwd();
const nsisDir = path.join(project, "src-tauri", "target", "release", "bundle", "nsis");
const releaseDir = path.join(project, "dist-release", `v${version}`);

if (!fs.existsSync(nsisDir)) {
  throw new Error(`Pasta NSIS não encontrada: ${nsisDir}`);
}

function listFiles(dir) {
  return fs.readdirSync(dir).map((name) => {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    return { name, full, stat };
  });
}

const files = listFiles(nsisDir);

const setup = files
  .filter((item) => item.name.toLowerCase().endsWith(".exe") && item.name.toLowerCase().includes("setup"))
  .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];

if (!setup) {
  throw new Error(`Setup .exe não encontrado em ${nsisDir}`);
}

let sig = files.find((item) => item.name === `${setup.name}.sig`);

if (!sig) {
  sig = files
    .filter((item) => item.name.toLowerCase().endsWith(".sig"))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
}

if (!sig) {
  throw new Error(
    `Arquivo .sig não encontrado em ${nsisDir}. Verifique se bundle.createUpdaterArtifacts=true e TAURI_SIGNING_PRIVATE_KEY foi definido.`,
  );
}

fs.mkdirSync(releaseDir, { recursive: true });

const cleanSetupName = `KPassword-Setup-v${version}.exe`;
const cleanSigName = `${cleanSetupName}.sig`;

const cleanSetupPath = path.join(releaseDir, cleanSetupName);
const cleanSigPath = path.join(releaseDir, cleanSigName);
const latestPath = path.join(releaseDir, "latest.json");

fs.copyFileSync(setup.full, cleanSetupPath);
fs.copyFileSync(sig.full, cleanSigPath);

const signature = fs.readFileSync(sig.full, "utf8").trim();

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${owner}/${repo}/releases/download/v${version}/${cleanSetupName}`,
    },
  },
};

fs.writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");

const manifestPath = path.join(releaseDir, "UPLOAD_THESE_FILES.txt");
fs.writeFileSync(
  manifestPath,
  [
    `GitHub Release tag: v${version}`,
    "",
    "Anexe estes arquivos no release:",
    `- ${cleanSetupName}`,
    `- ${cleanSigName}`,
    "- latest.json",
    "",
    "O app busca atualizações em:",
    `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`,
    "",
    "URL do instalador usada pelo updater:",
    latest.platforms["windows-x86_64"].url,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Setup base: ${setup.full}`);
console.log(`Signature base: ${sig.full}`);
console.log(`Release dir: ${releaseDir}`);
console.log(`latest.json criado: ${latestPath}`);
