param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$GitHubOwner = "mnstechbr",
  [string]$GitHubRepo = "KPassword",
  [Parameter(Mandatory = $true)] [string]$Version,
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

function Convert-SecureStringToPlainText {
  param([System.Security.SecureString]$Value)

  if (-not $Value -or $Value.Length -eq 0) {
    return ""
  }

  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
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
  throw @"
Chave do updater não encontrada.
Gere a chave manualmente e use uma senha forte:

npm run tauri signer generate -- -w "$KeyPath"

Depois rode este script novamente.
Não deixe a senha da chave em branco para releases públicos.
"@
}

if ([string]::IsNullOrWhiteSpace($KeyPassword)) {
  $SecurePassword = Read-Host "Senha da chave privada do updater" -AsSecureString
  $KeyPassword = Convert-SecureStringToPlainText $SecurePassword
}

if ([string]::IsNullOrEmpty($KeyPassword)) {
  throw "Senha da chave privada do updater é obrigatória para gerar release assinado com segurança."
}

Run-Step "1/7 Atualizando App.tsx, Cargo.toml e configuração do updater" {
  node $NodeScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath"
}

Run-Step "2/7 Conferindo dependências npm já instaladas" {
  if (-not (Test-Path (Join-Path $Project "node_modules"))) {
    throw "node_modules não encontrado. Rode npm install manualmente antes da release e confira package-lock.json."
  }
  npm --version | Out-Null
}

Run-Step "3/7 Regenerando ícones do Tauri" {
  npm run tauri icon app-icon.png
}

Run-Step "4/7 Validando frontend" {
  npm run build
}

Write-Host ""
Write-Host "5/7 Limpando bundle antigo" -ForegroundColor Cyan
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "6/7 Gerando instalador assinado" -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword
npm run tauri build
if ($LASTEXITCODE -ne 0) {
  throw "Falhou: npm run tauri build"
}

Run-Step "7/7 Montando dist-release\v$Version" {
  node $NodeScript --owner $GitHubOwner --repo $GitHubRepo --version $Version --key "$KeyPath" --make-release
}

$env:TAURI_SIGNING_PRIVATE_KEY = $null
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $null

Write-Host ""
Write-Host "Build v$Version concluído." -ForegroundColor Green
Write-Host ""
Write-Host "Pasta pronta para a release:" -ForegroundColor Cyan
Write-Host "$Project\dist-release\v$Version" -ForegroundColor White
Write-Host ""
Write-Host "Arquivos gerados:" -ForegroundColor Cyan
Get-ChildItem ".\dist-release\v$Version" | Select-Object Name, Length, LastWriteTime
Write-Host ""
Write-Host "Este script não faz git add, commit nem push." -ForegroundColor Yellow
Write-Host "Gere SHA256SUMS.txt e valide os assets antes de publicar." -ForegroundColor Yellow
Write-Host ""

explorer ".\dist-release\v$Version"
