param(
  [string]$Project = "C:\Projetos\KPassword",
  [Parameter(Mandatory = $true)] [string]$GitHubOwner,
  [Parameter(Mandatory = $true)] [string]$GitHubRepo,
  [Parameter(Mandatory = $true)] [string]$Version,
  [string]$Notes = "Primeira versão com atualizador automático oficial do KPassword."
)

$ErrorActionPreference = "Stop"

$BuildScript = Join-Path $Project "tools\build-updater-release.cjs"
if (-not (Test-Path $BuildScript)) {
  throw "Script Node não encontrado: $BuildScript"
}

Set-Location $Project

$KeyPath = Join-Path $env:USERPROFILE ".tauri\kpassword.key"
if (-not (Test-Path $KeyPath)) {
  throw "Chave privada não encontrada: $KeyPath"
}

$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath

Write-Host ""
Write-Host "1/5 Aplicando versão e endpoint..." -ForegroundColor Cyan
node ".\tools\setup-real-updater.cjs" --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath"

Write-Host ""
Write-Host "2/5 Regenerando ícones..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

Write-Host ""
Write-Host "3/5 Limpando bundle antigo..." -ForegroundColor Cyan
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "4/5 Gerando build assinado para updater..." -ForegroundColor Cyan
npm run tauri build

Write-Host ""
Write-Host "5/5 Montando pasta dist-release\v$Version..." -ForegroundColor Cyan
node $BuildScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --notes "$Notes"

Write-Host ""
Write-Host "Release pronta em:" -ForegroundColor Green
Write-Host "$Project\dist-release\v$Version" -ForegroundColor White
Write-Host ""
Write-Host "Arquivos que devem ir no GitHub Release v$Version:" -ForegroundColor Cyan
Get-ChildItem ".\dist-release\v$Version" | Select-Object Name, Length, LastWriteTime
Write-Host ""
explorer ".\dist-release\v$Version"
