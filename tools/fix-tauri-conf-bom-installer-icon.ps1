param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$ScriptPath = Join-Path $Project "tools\fix-tauri-conf-bom-installer-icon.cjs"

if (-not (Test-Path $ScriptPath)) {
  throw "Script Node não encontrado em: $ScriptPath"
}

Set-Location $Project

node $ScriptPath

Write-Host ""
Write-Host "Gerando ícones Tauri novamente..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

Write-Host ""
Write-Host "Gerando instalador..." -ForegroundColor Cyan
npm run tauri build

Write-Host ""
Write-Host "Instaladores encontrados:" -ForegroundColor Green
Get-ChildItem ".\src-tauri\target\release\bundle" -Recurse -Include *.exe,*.msi |
  Sort-Object LastWriteTime -Descending |
  Select-Object FullName, LastWriteTime
