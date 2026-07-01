param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

cd $Project

Write-Host ""
Write-Host "KPassword - auditoria rapida" -ForegroundColor Cyan
Write-Host ""

$package = Get-Content ".\package.json" -Raw | ConvertFrom-Json
$tauri = Get-Content ".\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$app = Get-Content ".\src\App.tsx" -Raw

$appVersion = ""
if ($app -match 'APP_VERSION\s*=\s*"([^"]+)"') {
  $appVersion = $Matches[1]
}

Write-Host "package.json:          $($package.version)"
Write-Host "tauri.conf.json:       $($tauri.version)"
Write-Host "src/App.tsx:           $appVersion"

if ($package.version -ne $tauri.version -or $package.version -ne $appVersion) {
  Write-Host ""
  Write-Host "VERSOES DIVERGENTES" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Versoes sincronizadas." -ForegroundColor Green

Write-Host ""
Write-Host "Arquivos essenciais:" -ForegroundColor Cyan

$required = @(
  "src\App.tsx",
  "src\App.css",
  "src\i18n.ts",
  "src\crypto.ts",
  "src-tauri\src\lib.rs",
  "src-tauri\tauri.conf.json",
  "tools\fix-updater-v030-build.ps1",
  "tools\fix-updater-v030-build.cjs"
)

foreach ($file in $required) {
  if (Test-Path $file) {
    Write-Host "OK  $file" -ForegroundColor Green
  } else {
    Write-Host "NOK $file" -ForegroundColor Red
    exit 1
  }
}

Write-Host ""
Write-Host "Busca por chaves privadas locais:" -ForegroundColor Cyan

$keys = Get-ChildItem -Recurse -File -Include *.key,*.key.pub -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\src-tauri\\target\\" }

if ($keys.Count -gt 0) {
  $keys | ForEach-Object { Write-Host "ATENCAO: $($_.FullName)" -ForegroundColor Yellow }
  Write-Host "Revise antes de commitar." -ForegroundColor Yellow
} else {
  Write-Host "Nenhuma chave privada encontrada dentro do projeto." -ForegroundColor Green
}

Write-Host ""
Write-Host "Auditoria concluida." -ForegroundColor Green
