param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$GitHubOwner = "mnstechbr",
  [string]$GitHubRepo = "KPassword",
  [string]$Version = "0.3.0",
  [string]$KeyPassword = ""
)

$ErrorActionPreference = "Stop"

function Run-Step {
  param(
    [Parameter(Mandatory = $true)] [string]$Title,
    [Parameter(Mandatory = $true)] [scriptblock]$Command
  )

  Write-Host ""
  Write-Host $Title -ForegroundColor Cyan
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "Falhou: $Title"
  }
}

$NodeScript = Join-Path $Project "tools\fix-updater-v030-build.cjs"
if (-not (Test-Path $NodeScript)) {
  throw "Script Node não encontrado: $NodeScript"
}

Set-Location $Project

$KeyPath = Join-Path $env:USERPROFILE ".tauri\kpassword.key"
$PubKeyPath = "$KeyPath.pub"

if (-not (Test-Path $KeyPath) -or -not (Test-Path $PubKeyPath)) {
  Write-Host ""
  Write-Host "Chave do updater não encontrada. Gerando agora..." -ForegroundColor Yellow
  Write-Host "Quando pedir senha da chave, pode deixar em branco para simplificar." -ForegroundColor Yellow
  npm run tauri signer generate -- -w $KeyPath

  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao gerar chave do updater."
  }
}

if (-not (Test-Path $KeyPath)) {
  throw "Chave privada não encontrada: $KeyPath"
}

if (-not (Test-Path $PubKeyPath)) {
  throw "Chave pública não encontrada: $PubKeyPath"
}

Run-Step "1/7 Corrigindo App.tsx, Cargo.toml e configuração do updater..." {
  node $NodeScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath"
}

Run-Step "2/7 Instalando/validando dependências npm..." {
  npm install
}

Run-Step "3/7 Regenerando ícones do Tauri..." {
  npm run tauri icon app-icon.png
}

Run-Step "4/7 Validando frontend..." {
  npm run build
}

Write-Host ""
Write-Host "5/7 Limpando bundle antigo..." -ForegroundColor Cyan
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "6/7 Gerando instalador assinado..." -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword
npm run tauri build
if ($LASTEXITCODE -ne 0) {
  throw "Falhou: npm run tauri build"
}

Run-Step "7/7 Montando dist-release\v$Version..." {
  node $NodeScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath" --make-release
}

Write-Host ""
Write-Host "Build v$Version concluído." -ForegroundColor Green
Write-Host ""
Write-Host "Pasta pronta para a release:" -ForegroundColor Cyan
Write-Host "$Project\dist-release\v$Version" -ForegroundColor White
Write-Host ""
Write-Host "Arquivos gerados:" -ForegroundColor Cyan
Get-ChildItem ".\dist-release\v$Version" | Select-Object Name, Length, LastWriteTime
Write-Host ""

explorer ".\dist-release\v$Version"
