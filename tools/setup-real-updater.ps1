param(
  [string]$Project = "C:\Projetos\KPassword",
  [Parameter(Mandatory = $true)] [string]$GitHubOwner,
  [Parameter(Mandatory = $true)] [string]$GitHubRepo,
  [Parameter(Mandatory = $true)] [string]$Version
)

$ErrorActionPreference = "Stop"

Set-Location $Project

Write-Host ""
Write-Host "setup-real-updater.ps1 é um script legado de configuração inicial." -ForegroundColor Yellow
Write-Host "Por segurança, ele não instala dependências nem cria chave automaticamente." -ForegroundColor Yellow
Write-Host "O updater já deve estar configurado no projeto atual." -ForegroundColor Yellow
Write-Host ""
Write-Host "Para gerar release assinada, use:" -ForegroundColor Cyan
Write-Host "powershell -ExecutionPolicy Bypass -File \".\tools\fix-updater-v030-build.ps1\" -Version \"$Version\" -GitHubOwner \"$GitHubOwner\" -GitHubRepo \"$GitHubRepo\"" -ForegroundColor White
Write-Host ""
Write-Host "A chave privada deve ficar em %USERPROFILE%\.tauri\kpassword.key, fora do repositório e protegida por senha forte." -ForegroundColor Yellow
