const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasArg = (name) => args.includes(`--${name}`);

const owner = getArg("owner", "mnstechbr");
const repo = getArg("repo", "KPassword");
const version = getArg("version");
const keyPath = getArg("key");
const makeRelease = hasArg("make-release");

if (!owner || !repo) throw new Error("Owner/repo ausentes.");
if (!keyPath) throw new Error("Caminho da chave ausente.");

if (!version) throw new Error("Informe --version.");

const project = process.cwd();

const files = {
  packageJson: path.join(project, "package.json"),
  app: path.join(project, "src", "App.tsx"),
  tauriConf: path.join(project, "src-tauri", "tauri.conf.json"),
  cargoToml: path.join(project, "src-tauri", "Cargo.toml"),
  capabilityDefault: path.join(project, "src-tauri", "capabilities", "default.json"),
  libRs: path.join(project, "src-tauri", "src", "lib.rs"),
};

function readNoBom(filePath) {
  let buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.slice(3);
  }
  return buffer.toString("utf8");
}

function writeNoBom(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function readJson(filePath) {
  return JSON.parse(readNoBom(filePath).trimStart());
}

function writeJson(filePath, value) {
  writeNoBom(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(filePath, `${filePath}.backup-final-updater-${stamp}`);
}

function ensurePackageJson() {
  backup(files.packageJson);
  const pkg = readJson(files.packageJson);
  pkg.version = version;
  pkg.dependencies ??= {};
  pkg.dependencies["@tauri-apps/plugin-updater"] ??= "^2";
  pkg.dependencies["@tauri-apps/plugin-process"] ??= "^2";
  writeJson(files.packageJson, pkg);
}

function ensureCargoToml() {
  if (!fs.existsSync(files.cargoToml)) return;
  backup(files.cargoToml);
  let cargo = readNoBom(files.cargoToml);

  cargo = cargo.replace(/(^\s*version\s*=\s*")[^"]+(")/m, `$1${version}$2`);

  if (!cargo.includes("tauri-plugin-process")) {
    if (cargo.includes("tauri-plugin-notification")) {
      cargo = cargo.replace(
        /(tauri-plugin-notification\s*=\s*"[^"]+"\s*)/,
        `$1\ntauri-plugin-process = "2"\n`,
      );
    } else {
      cargo += `\ntauri-plugin-process = "2"\n`;
    }
  }

  if (!cargo.includes("tauri-plugin-updater")) {
    cargo += `\n[target."cfg(any(target_os = \\"macos\\", windows, target_os = \\"linux\\"))".dependencies]\ntauri-plugin-updater = "2"\n`;
  }

  writeNoBom(files.cargoToml, cargo);
}

function ensureTauriConf() {
  backup(files.tauriConf);

  const pubKeyPath = `${keyPath}.pub`;
  if (!fs.existsSync(pubKeyPath)) {
    throw new Error(`Chave pública não encontrada: ${pubKeyPath}`);
  }

  const pubkey = readNoBom(pubKeyPath).trim();
  const config = readJson(files.tauriConf);

  config.version = version;

  config.bundle ??= {};
  config.bundle.active = true;
  config.bundle.createUpdaterArtifacts = true;
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

  config.plugins ??= {};
  config.plugins.updater ??= {};
  config.plugins.updater.pubkey = pubkey;
  config.plugins.updater.endpoints = [
    `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`,
  ];
  config.plugins.updater.windows ??= {};
  config.plugins.updater.windows.installMode = "passive";

  writeJson(files.tauriConf, config);
}

function ensureCapabilities() {
  let capabilityPath = files.capabilityDefault;

  if (!fs.existsSync(capabilityPath)) {
    fs.mkdirSync(path.dirname(capabilityPath), { recursive: true });
    writeJson(capabilityPath, {
      "$schema": "../gen/schemas/desktop-schema.json",
      identifier: "default",
      description: "Permissões principais do KPassword",
      windows: ["main"],
      permissions: ["core:default"],
    });
  }

  backup(capabilityPath);
  const capability = readJson(capabilityPath);
  capability.permissions ??= [];

  capability.permissions = capability.permissions.filter(
    (permission) => permission !== "opener:default" && permission !== "process:default",
  );

  for (const permission of ["updater:default", "process:allow-restart"]) {
    if (!capability.permissions.includes(permission)) {
      capability.permissions.push(permission);
    }
  }

  writeJson(capabilityPath, capability);
}

function ensureAppTsx() {
  if (!fs.existsSync(files.app)) return;
  backup(files.app);

  let app = readNoBom(files.app);

  app = app.replace(/const APP_VERSION\s*=\s*"[^"]*";/, `const APP_VERSION = "${version}";`);
  app = app.replace(/const UPDATE_GITHUB_OWNER\s*=\s*"[^"]*";/, `const UPDATE_GITHUB_OWNER = "${owner}";`);
  app = app.replace(/const UPDATE_GITHUB_REPO\s*=\s*"[^"]*";/, `const UPDATE_GITHUB_REPO = "${repo}";`);

  if (!app.includes("@tauri-apps/plugin-updater")) {
    throw new Error("App.tsx não parece estar com a função real do updater. Envie o App.tsx atual para ajuste manual.");
  }

  writeNoBom(files.app, app);
}

function ensureLibRs() {
  if (!fs.existsSync(files.libRs)) return;
  backup(files.libRs);

  let lib = readNoBom(files.libRs);

  if (!lib.includes("tauri_plugin_process::init()")) {
    lib = lib.replace(
      "tauri::Builder::default()",
      `tauri::Builder::default()\n        .plugin(tauri_plugin_process::init())`,
    );
  }

  if (!lib.includes("tauri_plugin_updater::Builder")) {
    lib = lib.replace(
      "tauri::Builder::default()",
      `tauri::Builder::default()\n        .plugin(tauri_plugin_updater::Builder::new().build())`,
    );
  }

  writeNoBom(files.libRs, lib);
}

function findNewestFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null;

  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      const nested = findNewestFile(full, predicate);
      if (nested) found.push(nested);
      continue;
    }
    if (predicate(name, full)) found.push({ name, full, stat });
  }

  return found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] ?? null;
}

function makeReleaseFolder() {
  const nsisDir = path.join(project, "src-tauri", "target", "release", "bundle", "nsis");
  const releaseDir = path.join(project, "dist-release", `v${version}`);

  const setup = findNewestFile(nsisDir, (name) => name.toLowerCase().endsWith(".exe") && name.toLowerCase().includes("setup"));
  if (!setup) {
    throw new Error(`Setup .exe não encontrado em ${nsisDir}`);
  }

  let sig = null;
  const exactSig = `${setup.full}.sig`;
  if (fs.existsSync(exactSig)) {
    sig = { name: path.basename(exactSig), full: exactSig, stat: fs.statSync(exactSig) };
  } else {
    sig = findNewestFile(nsisDir, (name) => name.toLowerCase().endsWith(".sig"));
  }

  if (!sig) {
    throw new Error(
      `Arquivo .sig não encontrado em ${nsisDir}. O build precisa gerar assinatura para o updater.`,
    );
  }

  fs.mkdirSync(releaseDir, { recursive: true });

  const setupName = `KPassword-Setup-v${version}.exe`;
  const setupPath = path.join(releaseDir, setupName);
  const sigPath = path.join(releaseDir, `${setupName}.sig`);
  const latestPath = path.join(releaseDir, "latest.json");

  fs.copyFileSync(setup.full, setupPath);
  fs.copyFileSync(sig.full, sigPath);

  const signature = readNoBom(sig.full).trim();

  const latest = {
    version,
    notes: "Versão com atualizador automático via GitHub Releases.",
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: `https://github.com/${owner}/${repo}/releases/download/v${version}/${setupName}`,
      },
    },
  };

  writeJson(latestPath, latest);

  writeNoBom(
    path.join(releaseDir, "UPLOAD_NO_GITHUB.txt"),
    [
      `Release: v${version}`,
      "",
      "Anexe estes arquivos no GitHub Release:",
      `- ${setupName}`,
      `- ${setupName}.sig`,
      "- latest.json",
      "",
      "Link para criar a release:",
      `https://github.com/${owner}/${repo}/releases/new`,
      "",
    ].join("\n"),
  );

  console.log(`Pasta de release criada: ${releaseDir}`);
  console.log(`Setup: ${setupPath}`);
  console.log(`latest.json: ${latestPath}`);
}

if (makeRelease) {
  makeReleaseFolder();
} else {
  ensurePackageJson();
  ensureCargoToml();
  ensureTauriConf();
  ensureCapabilities();
  ensureAppTsx();
  ensureLibRs();

  console.log("Configuração corrigida:");
  console.log(`- Owner/repo: ${owner}/${repo}`);
  console.log(`- Version: ${version}`);
  console.log(`- Endpoint: https://github.com/${owner}/${repo}/releases/latest/download/latest.json`);
  console.log("- createUpdaterArtifacts: true");
  console.log("- installerIcon/uninstallerIcon: icons/icon.ico");
}
