param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$GitHubOwner = "mnstechbr",
  [string]$GitHubRepo = "KPassword",
  [string]$Version = "0.3.0",
  [string]$KeyPassword = ""
)

$ErrorActionPreference = "Stop"

$NodeScript = Join-Path $Project "tools\finalizar-updater-v030.cjs"
if (-not (Test-Path $NodeScript)) {
  throw "Script Node não encontrado: $NodeScript"
}

Set-Location $Project

Write-Host ""
Write-Host "========== KPassword v$Version - Updater GitHub Release ==========" -ForegroundColor Cyan

Write-Host ""
Write-Host "1/9 Conferindo chave privada do updater..." -ForegroundColor Cyan
$KeyDir = Join-Path $env:USERPROFILE ".tauri"
$KeyPath = Join-Path $KeyDir "kpassword.key"
$PubKeyPath = "$KeyPath.pub"
New-Item -ItemType Directory -Force $KeyDir | Out-Null

if (-not (Test-Path $KeyPath) -or -not (Test-Path $PubKeyPath)) {
  Write-Host "Chave não encontrada. O Tauri vai pedir para criar uma chave." -ForegroundColor Yellow
  Write-Host "Quando pedir senha da chave, pode deixar em branco para simplificar." -ForegroundColor Yellow
  npm run tauri signer generate -- -w $KeyPath
}

if (-not (Test-Path $KeyPath)) {
  throw "Chave privada não encontrada: $KeyPath"
}
if (-not (Test-Path $PubKeyPath)) {
  throw "Chave pública não encontrada: $PubKeyPath"
}

Write-Host "Chave privada local:" -ForegroundColor Yellow
Write-Host $KeyPath -ForegroundColor White
Write-Host "NÃO suba esse arquivo para o GitHub." -ForegroundColor Yellow

Write-Host ""
Write-Host "2/9 Corrigindo arquivos do projeto..." -ForegroundColor Cyan
node $NodeScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath"

Write-Host ""
Write-Host "3/9 Instalando/validando dependências npm..." -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "4/9 Regenerando ícones..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

Write-Host ""
Write-Host "5/9 Validando frontend..." -ForegroundColor Cyan
npm run build

Write-Host ""
Write-Host "6/9 Limpando instaladores antigos..." -ForegroundColor Cyan
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "7/9 Gerando instalador assinado para updater..." -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword
npm run tauri build

Write-Host ""
Write-Host "8/9 Montando pasta dist-release\v$Version..." -ForegroundColor Cyan
node $NodeScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath" --make-release

Write-Host ""
Write-Host "9/9 Commitando e enviando correção para o GitHub..." -ForegroundColor Cyan
git add package.json package-lock.json src\App.tsx src-tauri\Cargo.toml src-tauri\Cargo.lock src-tauri\tauri.conf.json src-tauri\capabilities src-tauri\src\lib.rs tools\finalizar-updater-v030.cjs tools\finalizar-updater-v030.ps1 2>$null

$changes = git status --porcelain
if ($changes) {
  git commit -m "Configura updater automatico via GitHub Releases"
  git push
} else {
  Write-Host "Nenhuma alteração nova para commitar." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Pronto." -ForegroundColor Green
Write-Host ""
Write-Host "Agora crie a release v$Version no GitHub e anexe os arquivos desta pasta:" -ForegroundColor Cyan
Write-Host "$Project\dist-release\v$Version" -ForegroundColor White
Write-Host ""
Write-Host "Arquivos que devem ser anexados:" -ForegroundColor Cyan
Get-ChildItem ".\dist-release\v$Version" | Select-Object Name, Length, LastWriteTime
Write-Host ""
Write-Host "Link para criar a release:" -ForegroundColor Cyan
Write-Host "https://github.com/$GitHubOwner/$GitHubRepo/releases/new" -ForegroundColor White
Write-Host ""
explorer ".\dist-release\v$Version"
