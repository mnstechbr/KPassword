param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$ConfigPath = Join-Path $Project "src-tauri\tauri.conf.json"
$IconPng = Join-Path $Project "app-icon.png"
$IconIco = Join-Path $Project "src-tauri\icons\icon.ico"
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"

if (-not (Test-Path $ConfigPath)) {
  throw "tauri.conf.json não encontrado em: $ConfigPath"
}

if (-not (Test-Path $IconPng)) {
  throw "app-icon.png não encontrado em: $IconPng"
}

Set-Location $Project

Write-Host ""
Write-Host "Gerando novamente os ícones do Tauri a partir de app-icon.png..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

if (-not (Test-Path $IconIco)) {
  throw "icon.ico não foi gerado em: $IconIco"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = "$ConfigPath.backup-installer-icon-$timestamp"
Copy-Item $ConfigPath $BackupPath -Force

$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $config.bundle) {
  $config | Add-Member -MemberType NoteProperty -Name bundle -Value ([pscustomobject]@{})
}

$config.bundle.active = $true

# Garante que o app, atalhos e binário usem os ícones gerados.
$config.bundle.icon = @(
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
)

if (-not $config.bundle.windows) {
  $config.bundle | Add-Member -MemberType NoteProperty -Name windows -Value ([pscustomobject]@{})
}

if (-not $config.bundle.windows.nsis) {
  $config.bundle.windows | Add-Member -MemberType NoteProperty -Name nsis -Value ([pscustomobject]@{})
}

# Ponto que faltava: ícone específico do SETUP gerado pelo NSIS.
$config.bundle.windows.nsis.installerIcon = "icons/icon.ico"

# Deixa o desinstalador com o mesmo ícone também.
$config.bundle.windows.nsis.uninstallerIcon = "icons/icon.ico"

# Mantém instalação por usuário para não exigir admin à toa.
if (-not $config.bundle.windows.nsis.installMode) {
  $config.bundle.windows.nsis.installMode = "currentUser"
}

$config | ConvertTo-Json -Depth 80 | Set-Content -Path $ConfigPath -Encoding UTF8

# Remove instaladores antigos para evitar abrir o arquivo errado.
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "Configuração NSIS atualizada com sucesso." -ForegroundColor Green
Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "Agora gere o instalador com:" -ForegroundColor Cyan
Write-Host "npm run tauri build" -ForegroundColor White
Write-Host ""
