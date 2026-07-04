const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const owner = getArg("owner");
const repo = getArg("repo");
const version = getArg("version");
const keyPath = getArg("key");

if (!owner || !repo) {
  throw new Error("Informe --owner e --repo.");
}

if (!version) throw new Error("Informe --version.");

const project = process.cwd();

const files = {
  app: path.join(project, "src", "App.tsx"),
  tauriConf: path.join(project, "src-tauri", "tauri.conf.json"),
  libRs: path.join(project, "src-tauri", "src", "lib.rs"),
  packageJson: path.join(project, "package.json"),
  cargoToml: path.join(project, "src-tauri", "Cargo.toml"),
  capabilityDefault: path.join(project, "src-tauri", "capabilities", "default.json"),
  capabilityMain: path.join(project, "src-tauri", "capabilities", "main.json"),
};

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

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(filePath, `${filePath}.backup-updater-${stamp}`);
}

function readJson(filePath) {
  return JSON.parse(readNoBom(filePath).trimStart());
}

function writeJson(filePath, value) {
  writeNoBom(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function setVersionInPackageJson() {
  backup(files.packageJson);
  const pkg = readJson(files.packageJson);
  pkg.version = version;
  writeJson(files.packageJson, pkg);
}

function setVersionInCargoToml() {
  if (!fs.existsSync(files.cargoToml)) return;
  backup(files.cargoToml);
  let cargo = readNoBom(files.cargoToml);
  cargo = cargo.replace(/(^\s*version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
  writeNoBom(files.cargoToml, cargo);
}

function patchTauriConf() {
  backup(files.tauriConf);

  const pubKeyPath = `${keyPath}.pub`;
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

function patchLibRs() {
  if (!fs.existsSync(files.libRs)) return;
  backup(files.libRs);

  let lib = readNoBom(files.libRs);

  if (!lib.includes("tauri_plugin_updater::Builder")) {
    lib = lib.replace(
      "tauri::Builder::default()",
      `tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())`,
    );
  }

  if (!lib.includes("tauri_plugin_process::init()")) {
    lib = lib.replace(
      "tauri::Builder::default()",
      `tauri::Builder::default()
        .plugin(tauri_plugin_process::init())`,
    );
  }

  writeNoBom(files.libRs, lib);
}

function patchCapabilities() {
  const capabilityPath = fs.existsSync(files.capabilityDefault)
    ? files.capabilityDefault
    : files.capabilityMain;

  if (!fs.existsSync(capabilityPath)) {
    fs.mkdirSync(path.dirname(files.capabilityDefault), { recursive: true });
    writeJson(files.capabilityDefault, {
      "$schema": "../gen/schemas/desktop-schema.json",
      identifier: "default",
      description: "Default permissions for KPassword",
      windows: ["main"],
      permissions: [],
    });
  }

  const target = fs.existsSync(capabilityPath) ? capabilityPath : files.capabilityDefault;
  backup(target);

  const capability = readJson(target);
  capability.permissions ??= [];

  capability.permissions = capability.permissions.filter(
    (permission) => permission !== "opener:default" && permission !== "process:default",
  );

  for (const permission of ["updater:default", "process:allow-restart"]) {
    if (!capability.permissions.includes(permission)) {
      capability.permissions.push(permission);
    }
  }

  writeJson(target, capability);
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function replaceFunction(text, functionName, replacement) {
  const asyncNeedle = `async function ${functionName}`;
  let start = text.indexOf(asyncNeedle);

  if (start === -1) {
    const constNeedle = `const ${functionName}`;
    start = text.indexOf(constNeedle);
  }

  if (start === -1) {
    throw new Error(`Função ${functionName} não encontrada em App.tsx.`);
  }

  const openBrace = text.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error(`Abertura da função ${functionName} não encontrada.`);
  }

  const closeBrace = findMatchingBrace(text, openBrace);
  if (closeBrace === -1) {
    throw new Error(`Fechamento da função ${functionName} não encontrado.`);
  }

  let end = closeBrace + 1;

  while (text[end] === ";" || text[end] === "\r" || text[end] === "\n") {
    if (text[end] === ";") {
      end += 1;
      break;
    }
    end += 1;
  }

  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function patchAppTsx() {
  if (!fs.existsSync(files.app)) return;
  backup(files.app);

  let app = readNoBom(files.app);

  app = app.replace(
    /const UPDATE_GITHUB_OWNER\s*=\s*"[^"]*";/,
    `const UPDATE_GITHUB_OWNER = "${owner}";`,
  );
  app = app.replace(
    /const UPDATE_GITHUB_REPO\s*=\s*"[^"]*";/,
    `const UPDATE_GITHUB_REPO = "${repo}";`,
  );
  app = app.replace(
    /const APP_VERSION\s*=\s*"[^"]*";/,
    `const APP_VERSION = "${version}";`,
  );

  const realUpdaterFunction = `async function handleCheckUpdates() {
    setUpdateStatus("Verificando atualizações...");

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");

      const update = await check();

      if (!update) {
        setUpdateStatus(\`KPassword \${APP_VERSION}: nenhuma atualização encontrada.\`);
        return;
      }

      setUpdateStatus(\`Atualização \${update.version} encontrada. Baixando...\`);

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateStatus("Download da atualização iniciado...");
          return;
        }

        if (event.event === "Progress") {
          const loaded = "data" in event && typeof event.data === "object" && event.data && "chunkLength" in event.data
            ? Number(event.data.chunkLength)
            : 0;

          if (loaded > 0) {
            setUpdateStatus("Baixando e instalando atualização...");
          }
          return;
        }

        if (event.event === "Finished") {
          setUpdateStatus("Download concluído. Instalando atualização...");
        }
      });

      setUpdateStatus("Atualização instalada. Reiniciando o KPassword...");
      await relaunch();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setUpdateStatus(\`Falha ao verificar ou instalar atualização: \${detail}\`);
    }
  }`;

  app = replaceFunction(app, "handleCheckUpdates", realUpdaterFunction);

  writeNoBom(files.app, app);
}

setVersionInPackageJson();
setVersionInCargoToml();
patchTauriConf();
patchLibRs();
patchCapabilities();
patchAppTsx();

console.log("Arquivos ajustados para updater real:");
console.log(`- package.json -> ${version}`);
console.log(`- src-tauri/Cargo.toml -> ${version}`);
console.log(`- src-tauri/tauri.conf.json -> updater GitHub ${owner}/${repo}`);
console.log("- src-tauri/src/lib.rs -> plugins updater/process");
console.log("- capabilities -> updater:default/process:allow-restart");
console.log("- src/App.tsx -> botão Verificar atualizações com check/downloadAndInstall/relaunch");
