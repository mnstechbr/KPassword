$ErrorActionPreference = "Stop"

$Project = Split-Path -Parent $PSScriptRoot
$AppTsx = Join-Path $Project "src\App.tsx"
$AppCss = Join-Path $Project "src\App.css"

if (-not (Test-Path $AppTsx)) { throw "Arquivo não encontrado: src\App.tsx" }
if (-not (Test-Path $AppCss)) { throw "Arquivo não encontrado: src\App.css" }

$Tsx = Get-Content $AppTsx -Raw
$Css = Get-Content $AppCss -Raw

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

if ($Css -notlike "*KPassword v0.8.4 login desktop refinado START*") {
  throw "Patch incompleto em src\App.css. Bloco v0.8.4 não encontrado."
}

Write-Host "Patch v0.8.4 aplicado/validado com sucesso." -ForegroundColor Green
Write-Host "Ajustes incluídos:" -ForegroundColor Cyan
Write-Host "- Desktop com logo e painel de senha alinhados, sem container dividido." -ForegroundColor White
Write-Host "- Topo com tema à esquerda, cofre no centro e idioma à direita." -ForegroundColor White
Write-Host "- Fenda da logo mais visível ao digitar e ao desbloquear." -ForegroundColor White
