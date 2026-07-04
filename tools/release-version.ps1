param(
  [Parameter(Mandatory = $true)] [string]$Version,
  [string]$Message = "Manutencao documentacao e estabilidade"
)

$ErrorActionPreference = "Stop"

$Project = "C:\Projetos\KPassword"
cd $Project

Write-Host ""
Write-Host "KPassword release v$Version" -ForegroundColor Cyan
Write-Host ""

npm run build

powershell -ExecutionPolicy Bypass -File ".\tools\audit-project.ps1"

git status --short

Write-Host ""
Write-Host "Gerando commit..." -ForegroundColor Cyan

git add .
git commit -m $Message
git push

powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version $Version

explorer ".\dist-release\v$Version"
