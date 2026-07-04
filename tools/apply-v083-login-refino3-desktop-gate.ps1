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
  "aria-haspopup=\"listbox\""
)

foreach ($Marker in $RequiredTsx) {
  if ($Tsx -notlike "*$Marker*") {
    throw "Patch incompleto em src\App.tsx. Marcador ausente: $Marker"
  }
}

$RequiredCss = @(
  "KPassword login refino 3 desktop/gate sem alterar versao START",
  "--kp-login-form-width: clamp(420px, 32vw, 460px)",
  "kpasswordGateLeafLeftOpen",
  "kpasswordGateLeafRightOpen",
  "wrapper sem casca dupla",
  "position: static !important",
  "width: 88px !important"
)

foreach ($Marker in $RequiredCss) {
  if ($Css -notlike "*$Marker*") {
    throw "Patch incompleto em src\App.css. Marcador ausente: $Marker"
  }
}

Write-Host "Patch de refino 3 do login aplicado/validado com sucesso." -ForegroundColor Green
Write-Host "Sem alteração da versão do app/package." -ForegroundColor Cyan
Write-Host "Ajustes incluídos:" -ForegroundColor Cyan
Write-Host "- Idioma sem casca dupla e opções centralizadas." -ForegroundColor White
Write-Host "- Topo com espaços equilibrados entre tema, ações do cofre e idioma." -ForegroundColor White
Write-Host "- Frase do cofre bloqueado alinhada ao mesmo eixo dos campos e botões." -ForegroundColor White
Write-Host "- Portão vertical atrás da logo sem bloco/quadrado de fundo." -ForegroundColor White
