param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$LibPath = Join-Path $Project "src-tauri\src\lib.rs"
$TrayIconPath = Join-Path $Project "src-tauri\icons\tray-icon.png"

if (-not (Test-Path $LibPath)) {
  throw "src-tauri\src\lib.rs nao encontrado em $Project"
}

if (-not (Test-Path $TrayIconPath)) {
  throw "src-tauri\icons\tray-icon.png nao encontrado. Extraia o ZIP no projeto antes de rodar este script."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = "$LibPath.backup-tray-icon-size-$timestamp"
Copy-Item $LibPath $Backup -Force

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$lib = [System.IO.File]::ReadAllText($LibPath, [System.Text.Encoding]::UTF8)

# Garante import do Image do Tauri.
if ($lib -notmatch "image::Image") {
  $lib = $lib.Replace("use tauri::{`r`n    menu::{Menu, MenuItem},", "use tauri::{`r`n    image::Image,`r`n    menu::{Menu, MenuItem},")
  $lib = $lib.Replace("use tauri::{`n    menu::{Menu, MenuItem},", "use tauri::{`n    image::Image,`n    menu::{Menu, MenuItem},")
}

# Troca o icone padrao da janela por um icone dedicado da bandeja.
$oldDefaultIcon = ".icon(app.default_window_icon().unwrap().clone())"
$newTrayIcon = ".icon(Image::from_bytes(include_bytes!(\"../icons/tray-icon.png\"))?)"

if ($lib.Contains($oldDefaultIcon)) {
  $lib = $lib.Replace($oldDefaultIcon, $newTrayIcon)
} elseif ($lib -match "\.icon\(Image::from_bytes\(include_bytes!\(\"\.\./icons/tray-icon\.png\"\)\)\?\)") {
  Write-Host "lib.rs ja esta usando o icone dedicado da bandeja." -ForegroundColor Yellow
} else {
  throw "Nao encontrei a linha do icone da bandeja no TrayIconBuilder. Patch nao aplicado para evitar alterar o lugar errado."
}

[System.IO.File]::WriteAllText($LibPath, $lib, $utf8NoBom)

Write-Host ""
Write-Host "Icone dedicado da bandeja aplicado." -ForegroundColor Green
Write-Host "Backup criado em:" -ForegroundColor Yellow
Write-Host $Backup -ForegroundColor White
Write-Host ""
