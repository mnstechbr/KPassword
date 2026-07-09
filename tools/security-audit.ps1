$ErrorActionPreference = "Stop"

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)] [string] $Title,
    [Parameter(Mandatory = $true)] [scriptblock] $Command
  )

  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "Falhou: $Title"
  }
}

Invoke-Step "npm run build" { npm run build }

Invoke-Step "cargo check" {
  Push-Location "$Project\src-tauri"
  cargo check
  Pop-Location
}

Invoke-Step "cargo test" {
  Push-Location "$Project\src-tauri"
  cargo test
  Pop-Location
}

Invoke-Step "npm audit" { npm audit }

Write-Host ""
Write-Host "=== dependências Rust que usam quick-xml ===" -ForegroundColor Cyan
Push-Location "$Project\src-tauri"
try {
  cargo tree | Select-String -Pattern "quick-xml"
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "=== cargo audit ===" -ForegroundColor Cyan
$cargoAuditInstalled = $false
try {
  cargo audit --version *> $null
  $cargoAuditInstalled = $LASTEXITCODE -eq 0
} catch {
  $cargoAuditInstalled = $false
}

if ($cargoAuditInstalled) {
  Push-Location "$Project\src-tauri"
  cargo audit
  $AuditExit = $LASTEXITCODE
  Pop-Location

  if ($AuditExit -ne 0) {
    throw "Falhou: cargo audit"
  }
} else {
  Write-Host "cargo audit não está instalado. Instale com: cargo install cargo-audit" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Auditoria local concluída." -ForegroundColor Green
