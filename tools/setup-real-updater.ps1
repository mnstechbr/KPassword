param(
  [string]$Project = "C:\Projetos\KPassword",
  [Parameter(Mandatory = $true)] [string]$GitHubOwner,
  [Parameter(Mandatory = $true)] [string]$GitHubRepo,
  [Parameter(Mandatory = $true)] [string]$Version
)

$ErrorActionPreference = "Stop"

$ToolsDir = Join-Path $Project "tools"
$PatchScript = Join-Path $ToolsDir "setup-real-updater.cjs"

if (-not (Test-Path $PatchScript)) {
  throw "Script Node não encontrado: $PatchScript"
}

Set-Location $Project

Write-Host ""
Write-Host "1/7 Instalando dependências JavaScript do updater..." -ForegroundColor Cyan
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process

Write-Host ""
Write-Host "2/7 Instalando dependências Rust do updater/process..." -ForegroundColor Cyan
Push-Location ".\src-tauri"
cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
cargo add tauri-plugin-process
Pop-Location

Write-Host ""
Write-Host "3/7 Gerando chave de assinatura do updater, se ainda não existir..." -ForegroundColor Cyan
$KeyDir = Join-Path $env:USERPROFILE ".tauri"
$KeyPath = Join-Path $KeyDir "kpassword.key"
$PubKeyPath = "$KeyPath.pub"

New-Item -ItemType Directory -Force $KeyDir | Out-Null

if (-not (Test-Path $KeyPath) -or -not (Test-Path $PubKeyPath)) {
  Write-Host ""
  Write-Host "Será gerada uma chave privada em: $KeyPath" -ForegroundColor Yellow
  Write-Host "Guarde essa chave. Sem ela, versões futuras NÃO conseguirão atualizar usuários já instalados." -ForegroundColor Yellow
  Write-Host "Quando pedir senha da chave, você pode deixar em branco ou definir uma senha e guardar." -ForegroundColor Yellow
  Write-Host ""
  npm run tauri signer generate -- -w $KeyPath
}

if (-not (Test-Path $KeyPath)) {
  throw "Chave privada não encontrada: $KeyPath"
}

if (-not (Test-Path $PubKeyPath)) {
  throw "Chave pública não encontrada: $PubKeyPath"
}

Write-Host ""
Write-Host "4/7 Aplicando configuração real de atualização no código..." -ForegroundColor Cyan
node $PatchScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath"

Write-Host ""
Write-Host "5/7 Regenerando ícones..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

Write-Host ""
Write-Host "6/7 Validando frontend..." -ForegroundColor Cyan
npm run build

Write-Host ""
Write-Host "7/7 Concluído." -ForegroundColor Green
Write-Host ""
Write-Host "Updater configurado para:" -ForegroundColor Cyan
Write-Host "https://github.com/$GitHubOwner/$GitHubRepo/releases/latest/download/latest.json" -ForegroundColor White
Write-Host ""
Write-Host "Próximo comando para gerar pacote de release:" -ForegroundColor Cyan
Write-Host "powershell -ExecutionPolicy Bypass -File `".\tools\build-updater-release.ps1`" -GitHubOwner `"$GitHubOwner`" -GitHubRepo `"$GitHubRepo`" -Version `"$Version`"" -ForegroundColor White
Write-Host ""
