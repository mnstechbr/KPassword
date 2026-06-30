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
const version = getArg("version", "0.3.0");
const keyPath = getArg("key");
const makeRelease = hasArg("make-release");

if (!keyPath) throw new Error("Caminho da chave ausente.");

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
  fs.copyFileSync(filePath, `${filePath}.backup-fix-v030-${stamp}`);
}

function removeFunctionByName(source, functionName) {
  const needle = `function ${functionName}`;
  const start = source.indexOf(needle);
  if (start === -1) return source;

  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) return source;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        let end = i + 1;
        while (source[end] === "\r" || source[end] === "\n") end += 1;
        return `${source.slice(0, start)}${source.slice(end)}`;
      }
    }
  }

  return source;
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

function setDependencyInToml(toml, depName, depValue) {
  const lines = toml.split(/\r?\n/);
  const depHeaderIndex = lines.findIndex((line) => line.trim() === "[dependencies]");

  if (depHeaderIndex === -1) {
    lines.push("");
    lines.push("[dependencies]");
    lines.push(`${depName} = ${depValue}`);
    return lines.join("\n");
  }

  let nextSectionIndex = lines.length;
  for (let i = depHeaderIndex + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      nextSectionIndex = i;
      break;
    }
  }

  const existingIndex = lines.findIndex((line, index) => {
    return index > depHeaderIndex && index < nextSectionIndex && line.trim().startsWith(`${depName} `);
  });

  if (existingIndex >= 0) {
    lines[existingIndex] = `${depName} = ${depValue}`;
  } else {
    lines.splice(nextSectionIndex, 0, `${depName} = ${depValue}`);
  }

  return lines.join("\n");
}

function removeTargetUpdaterSections(toml) {
  const lines = toml.split(/\r?\n/);
  const output = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^\s*\[target\..*dependencies\]\s*$/.test(line)) {
      const section = [line];
      let j = i + 1;

      while (j < lines.length && !/^\s*\[/.test(lines[j])) {
        section.push(lines[j]);
        j += 1;
      }

      const hasUpdater = section.some((item) => item.includes("tauri-plugin-updater"));

      if (hasUpdater) {
        i = j - 1;
        continue;
      }
    }

    output.push(line);
  }

  return output.join("\n");
}

function ensureCargoToml() {
  if (!fs.existsSync(files.cargoToml)) return;

  backup(files.cargoToml);
  let cargo = readNoBom(files.cargoToml);

  cargo = cargo.replace(/(^\s*version\s*=\s*")[^"]+(")/m, `$1${version}$2`);

  cargo = removeTargetUpdaterSections(cargo);
  cargo = setDependencyInToml(cargo, "tauri-plugin-process", `"2"`);
  cargo = setDependencyInToml(cargo, "tauri-plugin-updater", `"2"`);

  writeNoBom(files.cargoToml, cargo.trimEnd() + "\n");
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
  const capabilityPath = files.capabilityDefault;

  if (!fs.existsSync(capabilityPath)) {
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

  for (const permission of ["updater:default", "process:default"]) {
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

  app = removeFunctionByName(app, "compareVersions");

  app = app.replace(/const APP_VERSION\s*=\s*"[^"]*";/, `const APP_VERSION = "${version}";`);
  app = app.replace(/const UPDATE_GITHUB_OWNER\s*=\s*"[^"]*";/, `const UPDATE_GITHUB_OWNER = "${owner}";`);
  app = app.replace(/const UPDATE_GITHUB_REPO\s*=\s*"[^"]*";/, `const UPDATE_GITHUB_REPO = "${repo}";`);

  if (!app.includes("@tauri-apps/plugin-updater")) {
    throw new Error("App.tsx não contém o plugin updater. Envie o App.tsx atual para ajuste manual.");
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
      "tauri::Builder::default()\n        .plugin(tauri_plugin_process::init())",
    );
  }

  if (!lib.includes("tauri_plugin_updater::Builder")) {
    lib = lib.replace(
      "tauri::Builder::default()",
      "tauri::Builder::default()\n        .plugin(tauri_plugin_updater::Builder::new().build())",
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

    if (predicate(name, full)) {
      found.push({ name, full, stat });
    }
  }

  return found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] ?? null;
}

function makeReleaseFolder() {
  const nsisDir = path.join(project, "src-tauri", "target", "release", "bundle", "nsis");
  const releaseDir = path.join(project, "dist-release", `v${version}`);

  const setup = findNewestFile(
    nsisDir,
    (name) => name.toLowerCase().endsWith(".exe") && name.toLowerCase().includes("setup"),
  );

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
    throw new Error(`Arquivo .sig não encontrado em ${nsisDir}.`);
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
      "Link:",
      `https://github.com/${owner}/${repo}/releases/new`,
      "",
    ].join("\n"),
  );

  console.log(`Pasta criada: ${releaseDir}`);
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

  console.log("Correções aplicadas:");
  console.log("- compareVersions removida do App.tsx");
  console.log("- Cargo.toml corrigido: updater/process em [dependencies]");
  console.log(`- Endpoint: https://github.com/${owner}/${repo}/releases/latest/download/latest.json`);
  console.log(`- Versão: ${version}`);
}
