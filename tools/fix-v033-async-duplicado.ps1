param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$AppPath = Join-Path $Project "src\App.tsx"

if (-not (Test-Path $AppPath)) {
  throw "src\App.tsx não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = "$AppPath.backup-async-duplicado-$timestamp"
Copy-Item $AppPath $BackupPath -Force

$app = Get-Content $AppPath -Raw -Encoding UTF8

$beforeMatches = [regex]::Matches($app, '\basync\s+async\s+function').Count

if ($beforeMatches -eq 0) {
  Write-Host ""
  Write-Host "Nenhum async duplicado encontrado. Nada foi alterado." -ForegroundColor Yellow
  Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
  Write-Host ""
  exit 0
}

$app = [regex]::Replace($app, '\basync\s+async\s+function', 'async function')

$afterMatches = [regex]::Matches($app, '\basync\s+async\s+function').Count

Set-Content -Path $AppPath -Value $app -Encoding UTF8

Write-Host ""
Write-Host "async duplicado corrigido com sucesso." -ForegroundColor Green
Write-Host "Ocorrências corrigidas: $beforeMatches" -ForegroundColor Cyan
Write-Host "Ocorrências restantes: $afterMatches" -ForegroundColor Cyan
Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
Write-Host ""
