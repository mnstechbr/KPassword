$Project = "C:\Projetos\KPassword"
$PatchRoot = Split-Path -Parent $PSScriptRoot

$Files = @(
  "src\App.tsx",
  "src\App.css",
  "src\i18n.ts"
)

foreach ($File in $Files) {
  $Source = Join-Path $PatchRoot $File
  $Destination = Join-Path $Project $File

  if (-not (Test-Path $Source)) {
    throw "Arquivo do patch não encontrado: $Source"
  }

  New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
  Copy-Item $Source $Destination -Force
  Write-Host "Aplicado: $File" -ForegroundColor Green
}

Write-Host ""
Write-Host "Reset limpo da tela de login aplicado sem alterar versão." -ForegroundColor Cyan
