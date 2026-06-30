param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$NodeScript = Join-Path $Project "tools\ensure-nsis-icon-config.cjs"
if (-not (Test-Path $NodeScript)) {
  throw "Script Node não encontrado em: $NodeScript"
}

Set-Location $Project

Write-Host ""
Write-Host "1/5 Garantindo configuração do ícone NSIS..." -ForegroundColor Cyan
node $NodeScript

Write-Host ""
Write-Host "2/5 Regenerando ícones do Tauri..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

$IconIco = Join-Path $Project "src-tauri\icons\icon.ico"
if (-not (Test-Path $IconIco)) {
  throw "icon.ico não encontrado em: $IconIco"
}

Write-Host ""
Write-Host "3/5 Removendo bundle antigo..." -ForegroundColor Cyan
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "4/5 Gerando instalador..." -ForegroundColor Cyan
npm run tauri build

$NsisDir = Join-Path $Project "src-tauri\target\release\bundle\nsis"
if (-not (Test-Path $NsisDir)) {
  throw "Pasta NSIS não foi gerada: $NsisDir"
}

$Setup = Get-ChildItem $NsisDir -Filter "*setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Setup) {
  throw "Setup NSIS não encontrado em: $NsisDir"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$UniqueSetupName = $Setup.BaseName + "-iconcheck-" + $timestamp + $Setup.Extension
$UniqueSetupPath = Join-Path $NsisDir $UniqueSetupName
Copy-Item $Setup.FullName $UniqueSetupPath -Force

Write-Host ""
Write-Host "5/5 Atualizando cache visual leve do Windows..." -ForegroundColor Cyan
try {
  Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -WindowStyle Hidden -Wait
} catch {
  Write-Host "Não foi possível executar ie4uinit.exe -show. Pode ignorar." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Instalador principal:" -ForegroundColor Green
Write-Host $Setup.FullName -ForegroundColor White
Write-Host ""
Write-Host "Cópia com nome único para testar cache do Explorer:" -ForegroundColor Green
Write-Host $UniqueSetupPath -ForegroundColor White
Write-Host ""
Write-Host "Abra a pasta NSIS e verifique primeiro o arquivo com '-iconcheck-' no nome." -ForegroundColor Cyan
Write-Host ""

explorer $NsisDir
