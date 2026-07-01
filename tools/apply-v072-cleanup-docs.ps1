param(
  [string]$Project = "C:\Projetos\KPassword",
  [string]$Version = "0.7.2"
)

$ErrorActionPreference = "Stop"

cd $Project

Write-Host ""
Write-Host "KPassword v$Version - limpeza e documentacao" -ForegroundColor Cyan
Write-Host ""

# Garante versoes sincronizadas mesmo se algum arquivo nao foi sobrescrito.
$packagePath = ".\package.json"
$lockPath = ".\package-lock.json"
$tauriPath = ".\src-tauri\tauri.conf.json"
$appPath = ".\src\App.tsx"

$package = Get-Content $packagePath -Raw | ConvertFrom-Json
$package.version = $Version
$package | ConvertTo-Json -Depth 20 | Set-Content $packagePath -Encoding UTF8

$lock = Get-Content $lockPath -Raw | ConvertFrom-Json
$lock.version = $Version
if ($lock.packages -and $lock.packages.PSObject.Properties.Name -contains "") {
  $lock.packages.PSObject.Properties[""].Value.version = $Version
}
$lock | ConvertTo-Json -Depth 100 | Set-Content $lockPath -Encoding UTF8

$tauri = Get-Content $tauriPath -Raw | ConvertFrom-Json
$tauri.version = $Version
$tauri | ConvertTo-Json -Depth 100 | Set-Content $tauriPath -Encoding UTF8

$app = Get-Content $appPath -Raw
$app = [regex]::Replace($app, 'APP_VERSION\s*=\s*"[^"]+"', "APP_VERSION = `"$Version`"", 1)
Set-Content $appPath $app -Encoding UTF8

# Arquiva scripts antigos de hotfix/experimentos, preservando os scripts essenciais.
$tools = Join-Path $Project "tools"
$archive = Join-Path $tools ("archive\legacy-hotfixes-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

$keep = @(
  "fix-updater-v030-build.ps1",
  "fix-updater-v030-build.cjs",
  "audit-project.ps1",
  "release-version.ps1",
  "apply-v072-cleanup-docs.ps1",
  "README.md"
)

if (Test-Path $tools) {
  $legacy = Get-ChildItem $tools -File | Where-Object {
    $keep -notcontains $_.Name
  }

  if ($legacy.Count -gt 0) {
    New-Item -ItemType Directory -Force $archive | Out-Null

    foreach ($file in $legacy) {
      Move-Item $file.FullName (Join-Path $archive $file.Name) -Force
    }

    Write-Host "Scripts antigos arquivados em:" -ForegroundColor Green
    Write-Host $archive -ForegroundColor White
  } else {
    Write-Host "Nenhum script antigo para arquivar." -ForegroundColor Yellow
  }
}

powershell -ExecutionPolicy Bypass -File ".\tools\audit-project.ps1"

Write-Host ""
Write-Host "v$Version preparada com sucesso." -ForegroundColor Green
Write-Host ""
