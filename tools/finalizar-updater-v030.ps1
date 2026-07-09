param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$GitHubOwner = "mnstechbr",
  [string]$GitHubRepo = "KPassword",
  [Parameter(Mandatory = $true)] [string]$Version,
  [string]$KeyPassword = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "tools\finalizar-updater-v030.ps1 é um wrapper legado." -ForegroundColor Yellow
Write-Host "Ele não faz git add, commit, push nem instala dependências automaticamente." -ForegroundColor Yellow
Write-Host "Encaminhando para tools\fix-updater-v030-build.ps1..." -ForegroundColor Cyan

$BuildScript = Join-Path $Project "tools\fix-updater-v030-build.ps1"
if (-not (Test-Path $BuildScript)) {
  throw "Script de build seguro não encontrado: $BuildScript"
}

& powershell -ExecutionPolicy Bypass -File $BuildScript `
  -Project $Project `
  -GitHubOwner $GitHubOwner `
  -GitHubRepo $GitHubRepo `
  -Version $Version `
  -KeyPassword $KeyPassword
