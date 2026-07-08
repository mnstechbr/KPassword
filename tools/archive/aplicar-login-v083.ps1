$Project = "C:\Projetos\KPassword"
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backup = Join-Path $env:USERPROFILE ("Downloads\kpassword-backup-login-v083-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

$Files = @(
  "src\App.tsx",
  "src\App.css",
  "src\i18n.ts"
)

if (!(Test-Path $Project)) {
  Write-Host "Projeto não encontrado em: $Project" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force $Backup | Out-Null

foreach ($File in $Files) {
  $SourceCurrent = Join-Path $Project $File
  $SourcePatch = Join-Path $PatchRoot $File
  $DestinationBackup = Join-Path $Backup $File
  $DestinationProject = Join-Path $Project $File

  if (!(Test-Path $SourcePatch)) {
    Write-Host "Arquivo do patch não encontrado: $SourcePatch" -ForegroundColor Red
    exit 1
  }

  if (Test-Path $SourceCurrent) {
    New-Item -ItemType Directory -Force (Split-Path $DestinationBackup) | Out-Null
    Copy-Item $SourceCurrent $DestinationBackup -Force
  }

  New-Item -ItemType Directory -Force (Split-Path $DestinationProject) | Out-Null
  Copy-Item $SourcePatch $DestinationProject -Force
}

Write-Host ""
Write-Host "Patch aplicado com sucesso." -ForegroundColor Green
Write-Host "Backup criado em:" -ForegroundColor Yellow
Write-Host $Backup -ForegroundColor White
Write-Host ""
Write-Host "Agora rode:" -ForegroundColor Cyan
Write-Host "cd `"$Project`""
Write-Host "npm.cmd run tauri dev"
Write-Host ""
