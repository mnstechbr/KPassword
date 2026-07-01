param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$Version = "0.8.2"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "KPassword v0.8.2 - hotfix contraste tema claro/misto" -ForegroundColor Cyan

$CssPath = Join-Path $Project "src\App.css"
if (-not (Test-Path $CssPath)) {
  throw "src\App.css nao encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = "$CssPath.backup-v082-contrast-$timestamp"
Copy-Item $CssPath $Backup -Force

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$css = [System.IO.File]::ReadAllText($CssPath, [System.Text.Encoding]::UTF8)

$start = "/* === KPassword v0.8.2 hotfix contraste claro/misto START === */"
$end = "/* === KPassword v0.8.2 hotfix contraste claro/misto END === */"

$patch = @'
/* === KPassword v0.8.2 hotfix contraste claro/misto START === */

.app.theme-light,
.app.theme-mixed,
body.theme-light,
body.theme-mixed,
[data-theme="light"],
[data-theme="mixed"] {
  --kp-light-text: #111827;
  --kp-light-muted: #475569;
  --kp-light-card: rgba(255, 255, 255, 0.94);
  --kp-light-card-strong: rgba(248, 250, 252, 0.97);
  --kp-light-blue-bg: #d8f1ff;
  --kp-light-blue-border: #9bd8f5;
  --kp-light-blue-text: #082f49;
  --kp-light-red-bg: #fee2e2;
  --kp-light-red-border: #fecaca;
  --kp-light-red-text: #7f1d1d;
  --kp-light-red-bg-active: linear-gradient(135deg, #dc2626, #991b1b);
  --kp-light-red-text-active: #ffffff;
}

/* Login: botão PIN legível em claro/misto */
.app.theme-light .pinButton,
.app.theme-mixed .pinButton,
.app.theme-light .helloButton,
.app.theme-mixed .helloButton,
.app.theme-light button[title*="PIN"],
.app.theme-mixed button[title*="PIN"],
.app.theme-light button[aria-label*="PIN"],
.app.theme-mixed button[aria-label*="PIN"] {
  color: var(--kp-light-blue-text) !important;
  background: var(--kp-light-blue-bg) !important;
  border-color: var(--kp-light-blue-border) !important;
  text-shadow: none !important;
  opacity: 1 !important;
}

.app.theme-light .pinButton:disabled,
.app.theme-mixed .pinButton:disabled,
.app.theme-light .helloButton:disabled,
.app.theme-mixed .helloButton:disabled,
.app.theme-light button[title*="PIN"]:disabled,
.app.theme-mixed button[title*="PIN"]:disabled,
.app.theme-light button[aria-label*="PIN"]:disabled,
.app.theme-mixed button[aria-label*="PIN"]:disabled {
  color: #334155 !important;
  background: #e2e8f0 !important;
  border-color: #cbd5e1 !important;
  opacity: 0.82 !important;
  text-shadow: none !important;
}

/* Lixeira: botões legíveis */
.app.theme-light .trashPage button,
.app.theme-mixed .trashPage button,
.app.theme-light .trashCard button,
.app.theme-mixed .trashCard button,
.app.theme-light .trashItem button,
.app.theme-mixed .trashItem button,
.app.theme-light .deletedItem button,
.app.theme-mixed .deletedItem button {
  color: var(--kp-light-blue-text) !important;
  background: var(--kp-light-blue-bg) !important;
  border-color: var(--kp-light-blue-border) !important;
  text-shadow: none !important;
  opacity: 1 !important;
}

.app.theme-light .trashPage button.danger,
.app.theme-mixed .trashPage button.danger,
.app.theme-light .trashCard button.danger,
.app.theme-mixed .trashCard button.danger,
.app.theme-light .trashItem button.danger,
.app.theme-mixed .trashItem button.danger,
.app.theme-light .deletedItem button.danger,
.app.theme-mixed .deletedItem button.danger,
.app.theme-light .dangerButton,
.app.theme-mixed .dangerButton,
.app.theme-light .danger,
.app.theme-mixed .danger {
  color: var(--kp-light-red-text) !important;
  background: var(--kp-light-red-bg) !important;
  border-color: var(--kp-light-red-border) !important;
  text-shadow: none !important;
  opacity: 1 !important;
}

.app.theme-light button.danger:disabled,
.app.theme-mixed button.danger:disabled,
.app.theme-light .dangerButton:disabled,
.app.theme-mixed .dangerButton:disabled,
.app.theme-light .trashPage button:disabled,
.app.theme-mixed .trashPage button:disabled {
  color: var(--kp-light-red-text) !important;
  background: #f2c7c7 !important;
  border-color: #e9b4b4 !important;
  opacity: 0.86 !important;
  text-shadow: none !important;
}

/* Cofre: itens, textos e ações visíveis em claro/misto */
.app.theme-light .credentialRow,
.app.theme-mixed .credentialRow,
.app.theme-light .vaultItem,
.app.theme-mixed .vaultItem,
.app.theme-light .itemRow,
.app.theme-mixed .itemRow,
.app.theme-light .credentialCard,
.app.theme-mixed .credentialCard {
  color: var(--kp-light-text) !important;
  background: var(--kp-light-card) !important;
  border-color: rgba(148, 163, 184, 0.36) !important;
  text-shadow: none !important;
}

.app.theme-light .credentialRow *,
.app.theme-mixed .credentialRow *,
.app.theme-light .vaultItem *,
.app.theme-mixed .vaultItem *,
.app.theme-light .itemRow *,
.app.theme-mixed .itemRow *,
.app.theme-light .credentialCard *,
.app.theme-mixed .credentialCard * {
  text-shadow: none !important;
}

.app.theme-light .credentialRow strong,
.app.theme-mixed .credentialRow strong,
.app.theme-light .credentialRow b,
.app.theme-mixed .credentialRow b,
.app.theme-light .credentialRow h3,
.app.theme-mixed .credentialRow h3,
.app.theme-light .vaultItem strong,
.app.theme-mixed .vaultItem strong,
.app.theme-light .itemRow strong,
.app.theme-mixed .itemRow strong,
.app.theme-light .credentialCard strong,
.app.theme-mixed .credentialCard strong {
  color: var(--kp-light-text) !important;
}

.app.theme-light .credentialRow span,
.app.theme-mixed .credentialRow span,
.app.theme-light .credentialRow p,
.app.theme-mixed .credentialRow p,
.app.theme-light .vaultItem span,
.app.theme-mixed .vaultItem span,
.app.theme-light .vaultItem p,
.app.theme-mixed .vaultItem p,
.app.theme-light .itemRow span,
.app.theme-mixed .itemRow span,
.app.theme-light .itemRow p,
.app.theme-mixed .itemRow p,
.app.theme-light .credentialCard span,
.app.theme-mixed .credentialCard span,
.app.theme-light .credentialCard p,
.app.theme-mixed .credentialCard p {
  color: var(--kp-light-muted) !important;
}

.app.theme-light .passwordDots,
.app.theme-mixed .passwordDots,
.app.theme-light .maskedPassword,
.app.theme-mixed .maskedPassword,
.app.theme-light .credentialPassword,
.app.theme-mixed .credentialPassword {
  color: #1e3a8a !important;
  -webkit-text-fill-color: #1e3a8a !important;
}

/* Ações das credenciais: copiar usuário, copiar senha, editar */
.app.theme-light .credentialActions button,
.app.theme-mixed .credentialActions button,
.app.theme-light .vaultActions button,
.app.theme-mixed .vaultActions button,
.app.theme-light .itemActions button,
.app.theme-mixed .itemActions button,
.app.theme-light .credentialRow button,
.app.theme-mixed .credentialRow button,
.app.theme-light .vaultItem button,
.app.theme-mixed .vaultItem button,
.app.theme-light .itemRow button,
.app.theme-mixed .itemRow button,
.app.theme-light .credentialCard button,
.app.theme-mixed .credentialCard button {
  color: var(--kp-light-blue-text) !important;
  background: var(--kp-light-blue-bg) !important;
  border-color: var(--kp-light-blue-border) !important;
  text-shadow: none !important;
  opacity: 1 !important;
}

/* Detalhe/modal da credencial */
.app.theme-light .itemDetail,
.app.theme-mixed .itemDetail,
.app.theme-light .detailCard,
.app.theme-mixed .detailCard,
.app.theme-light .detailPanel,
.app.theme-mixed .detailPanel,
.app.theme-light .modalContent,
.app.theme-mixed .modalContent,
.app.theme-light .modalBody,
.app.theme-mixed .modalBody {
  color: var(--kp-light-text) !important;
  background: var(--kp-light-card) !important;
  text-shadow: none !important;
}

.app.theme-light .itemDetail .wideCard,
.app.theme-mixed .itemDetail .wideCard,
.app.theme-light .itemDetail .sectionCard,
.app.theme-mixed .itemDetail .sectionCard,
.app.theme-light .detailCard .wideCard,
.app.theme-mixed .detailCard .wideCard,
.app.theme-light .attachmentPanel,
.app.theme-mixed .attachmentPanel,
.app.theme-light .passwordHistoryPanel,
.app.theme-mixed .passwordHistoryPanel,
.app.theme-light .attachmentsCard,
.app.theme-mixed .attachmentsCard,
.app.theme-light .historyCard,
.app.theme-mixed .historyCard {
  color: var(--kp-light-text) !important;
  background: var(--kp-light-card-strong) !important;
  border-color: rgba(148, 163, 184, 0.34) !important;
  text-shadow: none !important;
}

.app.theme-light .itemDetail h1,
.app.theme-mixed .itemDetail h1,
.app.theme-light .itemDetail h2,
.app.theme-mixed .itemDetail h2,
.app.theme-light .itemDetail h3,
.app.theme-mixed .itemDetail h3,
.app.theme-light .itemDetail strong,
.app.theme-mixed .itemDetail strong,
.app.theme-light .detailCard h1,
.app.theme-mixed .detailCard h1,
.app.theme-light .detailCard h2,
.app.theme-mixed .detailCard h2,
.app.theme-light .detailCard h3,
.app.theme-mixed .detailCard h3,
.app.theme-light .detailCard strong,
.app.theme-mixed .detailCard strong {
  color: var(--kp-light-text) !important;
}

.app.theme-light .itemDetail p,
.app.theme-mixed .itemDetail p,
.app.theme-light .itemDetail span,
.app.theme-mixed .itemDetail span,
.app.theme-light .detailCard p,
.app.theme-mixed .detailCard p,
.app.theme-light .detailCard span,
.app.theme-mixed .detailCard span {
  color: var(--kp-light-muted) !important;
}

/* Botões do detalhe: copiar, mostrar senha, abrir site, editar */
.app.theme-light .itemDetail button,
.app.theme-mixed .itemDetail button,
.app.theme-light .detailCard button,
.app.theme-mixed .detailCard button,
.app.theme-light .modalContent button,
.app.theme-mixed .modalContent button {
  text-shadow: none !important;
}

.app.theme-light .itemDetail button:not(.danger):not(.dangerButton),
.app.theme-mixed .itemDetail button:not(.danger):not(.dangerButton),
.app.theme-light .detailCard button:not(.danger):not(.dangerButton),
.app.theme-mixed .detailCard button:not(.danger):not(.dangerButton) {
  color: var(--kp-light-blue-text) !important;
  background: var(--kp-light-blue-bg) !important;
  border-color: var(--kp-light-blue-border) !important;
  opacity: 1 !important;
}

.app.theme-light .itemDetail button.danger,
.app.theme-mixed .itemDetail button.danger,
.app.theme-light .detailCard button.danger,
.app.theme-mixed .detailCard button.danger,
.app.theme-light .itemDetail .dangerButton,
.app.theme-mixed .itemDetail .dangerButton,
.app.theme-light .detailCard .dangerButton,
.app.theme-mixed .detailCard .dangerButton {
  color: var(--kp-light-red-text) !important;
  background: var(--kp-light-red-bg) !important;
  border-color: var(--kp-light-red-border) !important;
  opacity: 1 !important;
}

/* Fallback para cards brancos com botoes brancos */
.app.theme-light .wideCard button:not(.primaryButton):not(.addItemIconButton),
.app.theme-mixed .wideCard button:not(.primaryButton):not(.addItemIconButton),
.app.theme-light .sectionCard button:not(.primaryButton):not(.addItemIconButton),
.app.theme-mixed .sectionCard button:not(.primaryButton):not(.addItemIconButton) {
  text-shadow: none !important;
  color: var(--kp-light-blue-text) !important;
}

.app.theme-light .wideCard button.danger,
.app.theme-mixed .wideCard button.danger,
.app.theme-light .sectionCard button.danger,
.app.theme-mixed .sectionCard button.danger {
  color: var(--kp-light-red-text) !important;
}

.app.theme-light input,
.app.theme-mixed input,
.app.theme-light textarea,
.app.theme-mixed textarea,
.app.theme-light select,
.app.theme-mixed select {
  color: var(--kp-light-text) !important;
  -webkit-text-fill-color: var(--kp-light-text) !important;
}

.app.theme-light input::placeholder,
.app.theme-mixed input::placeholder,
.app.theme-light textarea::placeholder,
.app.theme-mixed textarea::placeholder {
  color: #64748b !important;
  -webkit-text-fill-color: #64748b !important;
}

/* === KPassword v0.8.2 hotfix contraste claro/misto END === */
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

$tempNode = Join-Path $env:TEMP "kpassword-v082-version.cjs"
[System.IO.File]::WriteAllText($tempNode, $nodeScript, $utf8NoBom)

Push-Location $Project
try {
  node $tempNode $Project $Version
} finally {
  Pop-Location
}

$ChangelogPath = Join-Path $Project "CHANGELOG.md"
if (Test-Path $ChangelogPath) {
  $changelog = [System.IO.File]::ReadAllText($ChangelogPath, [System.Text.Encoding]::UTF8)
  if ($changelog -notmatch "## \[0\.8\.2\]") {
    $entry = @"
## [0.8.2] - Hotfix

### Correcoes
- Corrige contraste no tema Claro e Misto.
- Corrige botao de acesso por PIN na tela de login.
- Corrige botoes Restaurar e Excluir definitivamente na Lixeira.
- Corrige botoes de acao das credenciais no Cofre.
- Corrige botoes do detalhe da credencial.
- Corrige textos claros sobre fundo claro em listas, cards e modais.

"@
    $changelog = $changelog -replace "(# Changelog\s*)", "`$1`r`n$entry"
    [System.IO.File]::WriteAllText($ChangelogPath, $changelog, $utf8NoBom)
  }
}

Write-Host ""
Write-Host "Hotfix aplicado com sucesso." -ForegroundColor Green
Write-Host "Backup do CSS: $Backup" -ForegroundColor Yellow
Write-Host "Versao ajustada para $Version" -ForegroundColor Cyan
Write-Host ""
