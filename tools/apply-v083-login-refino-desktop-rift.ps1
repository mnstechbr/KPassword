$ErrorActionPreference = "Stop"

$Project = Split-Path -Parent $PSScriptRoot
$AppTsx = Join-Path $Project "src\App.tsx"
$AppCss = Join-Path $Project "src\App.css"
$I18n = Join-Path $Project "src\i18n.ts"

if (-not (Test-Path $AppTsx)) { throw "Arquivo não encontrado: src\App.tsx" }
if (-not (Test-Path $AppCss)) { throw "Arquivo não encontrado: src\App.css" }
if (-not (Test-Path $I18n)) { throw "Arquivo não encontrado: src\i18n.ts" }

$Tsx = Get-Content $AppTsx -Raw
$Css = Get-Content $AppCss -Raw
$I18nText = Get-Content $I18n -Raw

$RequiredTsx = @(
  "unlockRiftOpen",
  "authUnlockSuccess",
  "setUnlockRiftOpen(true)",
  "window.setTimeout(resolve, 360)"
)

foreach ($Marker in $RequiredTsx) {
  if ($Tsx -notlike "*$Marker*") {
    throw "Patch incompleto em src\App.tsx. Marcador ausente: $Marker"
  }
}

$RequiredCss = @(
  "KPassword login refino desktop/rift sem alterar versao START",
  "--kp-login-panel-width",
  "kpasswordPanelRiftOpen",
  "authLogoStage::before",
  "white-space: nowrap"
)

foreach ($Marker in $RequiredCss) {
  if ($Css -notlike "*$Marker*") {
    throw "Patch incompleto em src\App.css. Marcador ausente: $Marker"
  }
}

if ($I18nText -notlike "*auth.vaultBlockedPanelLabel*") {
  throw "Patch incompleto em src\i18n.ts. Tradução auth.vaultBlockedPanelLabel não encontrada."
}

Write-Host "Patch de refino do login aplicado/validado com sucesso." -ForegroundColor Green
Write-Host "Sem alteração da versão do app/package." -ForegroundColor Cyan
Write-Host "Ajustes incluídos:" -ForegroundColor Cyan
Write-Host "- Fenda atrás da logo, com largura alinhada ao container de senha." -ForegroundColor White
Write-Host "- Frase COFRE BLOQUEADO centralizada e sem quebra palavra por palavra no desktop." -ForegroundColor White
Write-Host "- Campo de idioma e opções com alinhamento centralizado." -ForegroundColor White
