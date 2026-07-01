param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$Version = "0.8.2"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "KPassword v0.8.2 - hotfix real de contraste Claro/Misto" -ForegroundColor Cyan

$CssPath = Join-Path $Project "src\App.css"
if (-not (Test-Path $CssPath)) {
  throw "src\App.css nao encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = "$CssPath.backup-v082-real-contrast-$timestamp"
Copy-Item $CssPath $Backup -Force

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$css = [System.IO.File]::ReadAllText($CssPath, [System.Text.Encoding]::UTF8)

$start = "/* === KPassword v0.8.2 HOTFIX REAL contraste Claro/Misto START === */"
$end = "/* === KPassword v0.8.2 HOTFIX REAL contraste Claro/Misto END === */"

$patch = @'
/* === KPassword v0.8.2 HOTFIX REAL contraste Claro/Misto START === */

/*
  Correção real usando os seletores que o app usa:
  :root[data-theme="light"] e :root[data-theme="mixed"].

  Corrige:
  - Login: .authForm .windowsHelloButton
  - Cofre: .credentialRow, .rowActions, .rowPassword, .rowCategory, .rowHealth
  - Lixeira: .trashActions .secondaryButton e .trashActions .dangerButton
  - Detalhe: .detailPopup, .detailActions, .attachmentsBox, .historyBox
  - Botões internos: .attachmentActions, .historyActions, .fileImportButton
*/

:root[data-theme="light"],
:root[data-theme="mixed"] {
  --kp-fix-text: #0f172a;
  --kp-fix-muted: #475569;
  --kp-fix-soft: #64748b;
  --kp-fix-card: rgba(255, 255, 255, 0.96);
  --kp-fix-card-soft: rgba(248, 250, 252, 0.96);
  --kp-fix-blue-bg: #d8f1ff;
  --kp-fix-blue-bg-hover: #bae6fd;
  --kp-fix-blue-border: #93c5fd;
  --kp-fix-blue-text: #082f49;
  --kp-fix-red-bg: #fee2e2;
  --kp-fix-red-bg-hover: #fecaca;
  --kp-fix-red-border: #fca5a5;
  --kp-fix-red-text: #7f1d1d;
}

/* LOGIN - Acessar com PIN */
:root[data-theme="light"] .authForm .windowsHelloButton,
:root[data-theme="mixed"] .authForm .windowsHelloButton,
:root[data-theme="light"] .authPanel .windowsHelloButton,
:root[data-theme="mixed"] .authPanel .windowsHelloButton {
  background: var(--kp-fix-blue-bg) !important;
  color: var(--kp-fix-blue-text) !important;
  border: 1px solid var(--kp-fix-blue-border) !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--kp-fix-blue-text) !important;
}

:root[data-theme="light"] .authForm .windowsHelloButton:disabled,
:root[data-theme="mixed"] .authForm .windowsHelloButton:disabled,
:root[data-theme="light"] .authPanel .windowsHelloButton:disabled,
:root[data-theme="mixed"] .authPanel .windowsHelloButton:disabled {
  background: #e2e8f0 !important;
  color: #334155 !important;
  border-color: #cbd5e1 !important;
  opacity: 0.82 !important;
  -webkit-text-fill-color: #334155 !important;
}

/* COFRE - linha da credencial */
:root[data-theme="light"] .credentialRow,
:root[data-theme="mixed"] .credentialRow {
  background: var(--kp-fix-card) !important;
  color: var(--kp-fix-text) !important;
  border-color: rgba(148, 163, 184, 0.36) !important;
  text-shadow: none !important;
}

:root[data-theme="light"] .credentialRow:hover,
:root[data-theme="mixed"] .credentialRow:hover {
  background: #ffffff !important;
  border-color: rgba(14, 165, 233, 0.34) !important;
}

:root[data-theme="light"] .credentialRow *,
:root[data-theme="mixed"] .credentialRow * {
  text-shadow: none !important;
}

:root[data-theme="light"] .rowMain strong,
:root[data-theme="mixed"] .rowMain strong,
:root[data-theme="light"] .credentialRow strong,
:root[data-theme="mixed"] .credentialRow strong {
  color: var(--kp-fix-text) !important;
  -webkit-text-fill-color: var(--kp-fix-text) !important;
}

:root[data-theme="light"] .rowMain small,
:root[data-theme="mixed"] .rowMain small,
:root[data-theme="light"] .rowHealth,
:root[data-theme="mixed"] .rowHealth,
:root[data-theme="light"] .rowHealth span,
:root[data-theme="mixed"] .rowHealth span {
  color: var(--kp-fix-muted) !important;
  -webkit-text-fill-color: var(--kp-fix-muted) !important;
}

:root[data-theme="light"] .rowPassword,
:root[data-theme="mixed"] .rowPassword {
  color: #1e3a8a !important;
  -webkit-text-fill-color: #1e3a8a !important;
}

:root[data-theme="light"] .rowCategory,
:root[data-theme="mixed"] .rowCategory {
  background: #e0f2fe !important;
  color: #075985 !important;
  border: 1px solid rgba(14, 165, 233, 0.18) !important;
  -webkit-text-fill-color: #075985 !important;
}

:root[data-theme="light"] .rowStar,
:root[data-theme="mixed"] .rowStar {
  color: #475569 !important;
}

:root[data-theme="light"] .rowStar.active,
:root[data-theme="mixed"] .rowStar.active {
  color: #b45309 !important;
}

:root[data-theme="light"] .reorderControls button,
:root[data-theme="mixed"] .reorderControls button {
  background: #eef2ff !important;
  color: #334155 !important;
  border: 1px solid rgba(99, 102, 241, 0.14) !important;
  -webkit-text-fill-color: #334155 !important;
}

:root[data-theme="light"] .reorderControls button:disabled,
:root[data-theme="mixed"] .reorderControls button:disabled {
  background: #f1f5f9 !important;
  color: #94a3b8 !important;
  opacity: 0.76 !important;
  -webkit-text-fill-color: #94a3b8 !important;
}

/* COFRE - botões Copiar usuário / Copiar senha / Editar */
:root[data-theme="light"] .rowActions button,
:root[data-theme="mixed"] .rowActions button {
  background: var(--kp-fix-blue-bg) !important;
  color: var(--kp-fix-blue-text) !important;
  border: 1px solid var(--kp-fix-blue-border) !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--kp-fix-blue-text) !important;
}

:root[data-theme="light"] .rowActions button:hover:not(:disabled),
:root[data-theme="mixed"] .rowActions button:hover:not(:disabled) {
  background: var(--kp-fix-blue-bg-hover) !important;
  color: #082f49 !important;
  -webkit-text-fill-color: #082f49 !important;
}

/* LIXEIRA */
:root[data-theme="light"] .trashItem,
:root[data-theme="mixed"] .trashItem {
  background: var(--kp-fix-card) !important;
  color: var(--kp-fix-text) !important;
  border-color: rgba(148, 163, 184, 0.36) !important;
}

:root[data-theme="light"] .trashItem strong,
:root[data-theme="mixed"] .trashItem strong {
  color: var(--kp-fix-text) !important;
  -webkit-text-fill-color: var(--kp-fix-text) !important;
}

:root[data-theme="light"] .trashItem span,
:root[data-theme="mixed"] .trashItem span {
  color: var(--kp-fix-muted) !important;
  -webkit-text-fill-color: var(--kp-fix-muted) !important;
}

:root[data-theme="light"] .trashActions .secondaryButton,
:root[data-theme="mixed"] .trashActions .secondaryButton {
  background: var(--kp-fix-blue-bg) !important;
  color: var(--kp-fix-blue-text) !important;
  border: 1px solid var(--kp-fix-blue-border) !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--kp-fix-blue-text) !important;
}

:root[data-theme="light"] .trashActions .dangerButton,
:root[data-theme="mixed"] .trashActions .dangerButton {
  background: var(--kp-fix-red-bg) !important;
  color: var(--kp-fix-red-text) !important;
  border: 1px solid var(--kp-fix-red-border) !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--kp-fix-red-text) !important;
}

:root[data-theme="light"] .trashActions .dangerButton:hover:not(:disabled),
:root[data-theme="mixed"] .trashActions .dangerButton:hover:not(:disabled) {
  background: var(--kp-fix-red-bg-hover) !important;
  color: #7f1d1d !important;
  -webkit-text-fill-color: #7f1d1d !important;
}

/* DETALHE DA CREDENCIAL */
:root[data-theme="light"] .detailPopup,
:root[data-theme="mixed"] .detailPopup {
  background: #ffffff !important;
  color: var(--kp-fix-text) !important;
  border-color: rgba(148, 163, 184, 0.42) !important;
  text-shadow: none !important;
}

:root[data-theme="light"] .detailPopup h2,
:root[data-theme="mixed"] .detailPopup h2,
:root[data-theme="light"] .detailPopup h3,
:root[data-theme="mixed"] .detailPopup h3,
:root[data-theme="light"] .detailPopup strong,
:root[data-theme="mixed"] .detailPopup strong {
  color: var(--kp-fix-text) !important;
  -webkit-text-fill-color: var(--kp-fix-text) !important;
}

:root[data-theme="light"] .detailPopup p,
:root[data-theme="mixed"] .detailPopup p,
:root[data-theme="light"] .detailPopup span,
:root[data-theme="mixed"] .detailPopup span,
:root[data-theme="light"] .detailPopup small,
:root[data-theme="mixed"] .detailPopup small {
  color: var(--kp-fix-muted) !important;
  -webkit-text-fill-color: var(--kp-fix-muted) !important;
}

:root[data-theme="light"] .detailGrid div,
:root[data-theme="mixed"] .detailGrid div,
:root[data-theme="light"] .notesBox,
:root[data-theme="mixed"] .notesBox,
:root[data-theme="light"] .attachmentsBox,
:root[data-theme="mixed"] .attachmentsBox,
:root[data-theme="light"] .historyBox,
:root[data-theme="mixed"] .historyBox,
:root[data-theme="light"] .attachmentItem,
:root[data-theme="mixed"] .attachmentItem,
:root[data-theme="light"] .historyItem,
:root[data-theme="mixed"] .historyItem {
  background: var(--kp-fix-card-soft) !important;
  color: var(--kp-fix-text) !important;
  border-color: rgba(148, 163, 184, 0.32) !important;
  text-shadow: none !important;
}

/* DETALHE - botões inferiores e internos */
:root[data-theme="light"] .detailActions button,
:root[data-theme="mixed"] .detailActions button,
:root[data-theme="light"] .attachmentActions button,
:root[data-theme="mixed"] .attachmentActions button,
:root[data-theme="light"] .historyActions button,
:root[data-theme="mixed"] .historyActions button,
:root[data-theme="light"] .detailPopup .fileImportButton,
:root[data-theme="mixed"] .detailPopup .fileImportButton,
:root[data-theme="light"] .detailPopup .inlineFileButton,
:root[data-theme="mixed"] .detailPopup .inlineFileButton {
  background: var(--kp-fix-blue-bg) !important;
  color: var(--kp-fix-blue-text) !important;
  border: 1px solid var(--kp-fix-blue-border) !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--kp-fix-blue-text) !important;
}

:root[data-theme="light"] .detailActions .dangerButton,
:root[data-theme="mixed"] .detailActions .dangerButton,
:root[data-theme="light"] .attachmentActions .dangerButton,
:root[data-theme="mixed"] .attachmentActions .dangerButton,
:root[data-theme="light"] .historyBox .dangerButton,
:root[data-theme="mixed"] .historyBox .dangerButton,
:root[data-theme="light"] .detailPopup .dangerButton,
:root[data-theme="mixed"] .detailPopup .dangerButton {
  background: var(--kp-fix-red-bg) !important;
  color: var(--kp-fix-red-text) !important;
  border: 1px solid var(--kp-fix-red-border) !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--kp-fix-red-text) !important;
}

:root[data-theme="light"] .historyBox .dangerButton:disabled,
:root[data-theme="mixed"] .historyBox .dangerButton:disabled,
:root[data-theme="light"] .detailPopup .dangerButton:disabled,
:root[data-theme="mixed"] .detailPopup .dangerButton:disabled {
  background: #f2c7c7 !important;
  color: #7f1d1d !important;
  border-color: #e9b4b4 !important;
  opacity: 0.86 !important;
  -webkit-text-fill-color: #7f1d1d !important;
}

/* Fallback final: qualquer secondary/ghost dentro de superfície clara */
:root[data-theme="light"] .wideCard .secondaryButton,
:root[data-theme="mixed"] .wideCard .secondaryButton,
:root[data-theme="light"] .wideCard .ghostButton,
:root[data-theme="mixed"] .wideCard .ghostButton,
:root[data-theme="light"] .detailPopup button:not(.primaryButton):not(.dangerButton),
:root[data-theme="mixed"] .detailPopup button:not(.primaryButton):not(.dangerButton) {
  color: var(--kp-fix-blue-text) !important;
  -webkit-text-fill-color: var(--kp-fix-blue-text) !important;
  text-shadow: none !important;
}

:root[data-theme="light"] input,
:root[data-theme="mixed"] input,
:root[data-theme="light"] textarea,
:root[data-theme="mixed"] textarea,
:root[data-theme="light"] select,
:root[data-theme="mixed"] select {
  color: var(--kp-fix-text) !important;
  -webkit-text-fill-color: var(--kp-fix-text) !important;
}

/* === KPassword v0.8.2 HOTFIX REAL contraste Claro/Misto END === */
'@

$regex = [regex]::Escape($start) + "[\s\S]*?" + [regex]::Escape($end)
if ([regex]::IsMatch($css, $regex)) {
  $css = [regex]::Replace($css, $regex, $patch)
} else {
  $css = $css.TrimEnd() + "`r`n`r`n" + $patch + "`r`n"
}

[System.IO.File]::WriteAllText($CssPath, $css, $utf8NoBom)

$nodeScript = @'
const fs = require("fs");
const path = require("path");

const project = process.argv[2];
const version = process.argv[3];

function readJson(file) {
  const full = path.join(project, file);
  if (!fs.existsSync(full)) return null;
  const text = fs.readFileSync(full, "utf8").replace(/^\uFEFF/, "");
  return [full, JSON.parse(text)];
}

function writeJson(full, data) {
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + "\n", "utf8");
}

for (const file of ["package.json", "package-lock.json"]) {
  const result = readJson(file);
  if (!result) continue;
  const [full, json] = result;
  json.version = version;
  if (json.packages && json.packages[""]) json.packages[""].version = version;
  writeJson(full, json);
}

const result = readJson(path.join("src-tauri", "tauri.conf.json"));
if (result) {
  const [full, json] = result;
  json.version = version;
  writeJson(full, json);
}
'@

$tempNode = Join-Path $env:TEMP "kpassword-v082-real-version.cjs"
[System.IO.File]::WriteAllText($tempNode, $nodeScript, $utf8NoBom)

Push-Location $Project
try {
  node $tempNode $Project $Version
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Hotfix real aplicado com sucesso." -ForegroundColor Green
Write-Host "Backup do CSS: $Backup" -ForegroundColor Yellow
Write-Host "Versao ajustada para $Version" -ForegroundColor Cyan
Write-Host ""
