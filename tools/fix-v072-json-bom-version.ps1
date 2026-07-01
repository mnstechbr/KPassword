param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$Version = "0.7.2"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "KPassword v0.7.2 - corrigir BOM/JSON e versao" -ForegroundColor Cyan

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Remove-BomIfExists {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
    Write-Host "BOM removido: $Path" -ForegroundColor Yellow
  }
}

# Remove BOM dos arquivos que o Vite/Tauri/Node podem tentar ler como JSON/config.
$filesToClean = @(
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "src-tauri\tauri.conf.json",
  "src-tauri\capabilities\default.json"
)

foreach ($file in $filesToClean) {
  Remove-BomIfExists (Join-Path $Project $file)
}

# Regrava package.json e package-lock.json via Node, sem BOM, sem PowerShell ConvertFrom-Json.
$nodeScript = @'
const fs = require("fs");
const path = require("path");

const project = process.argv[2];
const version = process.argv[3];

function readJson(file) {
  const full = path.join(project, file);
  let text = fs.readFileSync(full, "utf8");
  text = text.replace(/^\uFEFF/, "");
  return [full, JSON.parse(text)];
}

function writeJson(full, data) {
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + "\n", "utf8");
}

{
  const [full, pkg] = readJson("package.json");
  pkg.version = version;
  writeJson(full, pkg);
}

{
  const lockPath = path.join(project, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    let text = fs.readFileSync(lockPath, "utf8").replace(/^\uFEFF/, "");
    const lock = JSON.parse(text);
    lock.version = version;

    if (lock.packages && lock.packages[""]) {
      lock.packages[""].version = version;
    }

    writeJson(lockPath, lock);
  }
}

{
  const tauriPath = path.join(project, "src-tauri", "tauri.conf.json");
  if (fs.existsSync(tauriPath)) {
    let text = fs.readFileSync(tauriPath, "utf8").replace(/^\uFEFF/, "");
    const conf = JSON.parse(text);
    conf.version = version;
    writeJson(tauriPath, conf);
  }
}

console.log(`Versao ajustada para ${version} sem BOM.`);
'@

$tempNode = Join-Path $env:TEMP "kpassword-fix-v072-json-bom-version.cjs"
[System.IO.File]::WriteAllText($tempNode, $nodeScript, $utf8NoBom)

Push-Location $Project
try {
  node $tempNode $Project $Version
} finally {
  Pop-Location
}

# Garante novamente que nada ficou com BOM depois da escrita.
foreach ($file in $filesToClean) {
  Remove-BomIfExists (Join-Path $Project $file)
}

Write-Host ""
Write-Host "Correção concluída." -ForegroundColor Green
Write-Host "Agora rode: npm run build" -ForegroundColor White
Write-Host ""
