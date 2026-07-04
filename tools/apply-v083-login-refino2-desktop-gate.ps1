$ErrorActionPreference = "Stop"

$Project = Split-Path -Parent $PSScriptRoot
$AppTsx = Join-Path $Project "src\App.tsx"
$AppCss = Join-Path $Project "src\App.css"

if (-not (Test-Path $AppTsx)) { throw "Arquivo não encontrado: src\App.tsx" }
if (-not (Test-Path $AppCss)) { throw "Arquivo não encontrado: src\App.css" }

$Tsx = Get-Content $AppTsx -Raw
$Css = Get-Content $AppCss -Raw

$RequiredTsx = @(
  "customLanguageSelect",
  "languageSelectButton",
  "languageOptions",
  "aria-haspopup=\"listbox\"",
  "setOpen(false)"
)

foreach ($Marker in $RequiredTsx) {
  if ($Tsx -notlike "*$Marker*") {
    throw "Patch incompleto em src\App.tsx. Marcador ausente: $Marker"
  }
}

$RequiredCss = @(
  "KPassword login refino 2 desktop/gate sem alterar versao START",
  "--kp-login-panel-width: clamp(500px, 38vw, 560px)",
  "kpasswordGateLeftOpen",
  "kpasswordGateRightOpen",
  "customLanguageSelect",
  "grid-template-columns: auto auto auto",
  "white-space: nowrap"
)

foreach ($Marker in $RequiredCss) {
  if ($Css -notlike "*$Marker*") {
    throw "Patch incompleto em src\App.css. Marcador ausente: $Marker"
  }
}

Write-Host "Patch de refino 2 do login aplicado/validado com sucesso." -ForegroundColor Green
Write-Host "Sem alteração da versão do app/package." -ForegroundColor Cyan
Write-Host "Ajustes incluídos:" -ForegroundColor Cyan
Write-Host "- Menu de idioma compacto customizado com opções centralizadas." -ForegroundColor White
Write-Host "- Container de desbloqueio mais largo no desktop para conter a frase inteira." -ForegroundColor White
Write-Host "- Animação de portão vertical abrindo atrás da logo." -ForegroundColor White
Write-Host "- Espaçamento superior equilibrado entre tema, botões centrais e idioma." -ForegroundColor White
