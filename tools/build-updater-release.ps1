param(
  [string]$Project = "C:\Projetos\KPassword",
  [Parameter(Mandatory = $true)] [string]$GitHubOwner,
  [Parameter(Mandatory = $true)] [string]$GitHubRepo,
  [Parameter(Mandatory = $true)] [string]$Version,
  [string]$Notes = "Release do KPassword."
)

$ErrorActionPreference = "Stop"

$BuildScript = Join-Path $Project "tools\fix-updater-v030-build.ps1"
if (-not (Test-Path $BuildScript)) {
  throw "Script de build seguro não encontrado: $BuildScript"
}

Write-Host ""
Write-Host "build-updater-release.ps1 é um wrapper legado." -ForegroundColor Yellow
Write-Host "Ele não instala dependências automaticamente e não faz git add/commit/push." -ForegroundColor Yellow
Write-Host "Encaminhando para tools\fix-updater-v030-build.ps1..." -ForegroundColor Cyan

& powershell -ExecutionPolicy Bypass -File $BuildScript `
  -Project $Project `
  -GitHubOwner $GitHubOwner `
  -GitHubRepo $GitHubRepo `
  -Version $Version
