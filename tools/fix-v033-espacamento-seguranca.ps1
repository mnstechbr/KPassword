param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = "$CssPath.backup-espacamento-seguranca-$timestamp"
Copy-Item $CssPath $BackupPath -Force

$start = "/* === KPassword v0.3.3 hotfix spacing security settings START === */"
$end = "/* === KPassword v0.3.3 hotfix spacing security settings END === */"

$patch = @'
/* v0.3.3 hotfix - espaçamento do card Configurações de segurança */
.securityActionCard .settingsControlGrid {
  margin-top: 18px !important;
  margin-bottom: 18px !important;
  gap: 16px !important;
}

.securityActionCard .settingsControlGrid label {
  display: grid !important;
  gap: 9px !important;
  align-content: start !important;
  min-width: 0 !important;
  line-height: 1.35 !important;
}

.securityActionCard .settingsControlGrid input {
  margin-top: 2px !important;
}

.securityActionCard .toggleList {
  margin-top: 18px !important;
  gap: 14px !important;
}

.securityActionCard .toggleRow {
  gap: 18px !important;
  padding: 16px !important;
  min-height: 74px !important;
}

.securityActionCard .toggleRow span {
  gap: 6px !important;
  min-width: 0 !important;
}

.securityActionCard .toggleRow strong {
  line-height: 1.3 !important;
}

.securityActionCard .toggleRow small {
  line-height: 1.55 !important;
}

.securityActionCard > .securityGrid {
  margin-top: 18px !important;
  gap: 12px !important;
}

.securityActionCard > h2 + p {
  margin-bottom: 0 !important;
}

@media (max-width: 720px) {
  .securityActionCard .settingsControlGrid {
    gap: 14px !important;
  }

  .securityActionCard .toggleRow {
    min-height: auto !important;
    padding: 16px !important;
  }

  .securityActionCard .toggleRow input {
    align-self: flex-start !important;
  }
}
'@

$css = Get-Content $CssPath -Raw -Encoding UTF8

$pattern = [regex]::Escape($start) + "[\s\S]*?" + [regex]::Escape($end)

if ([regex]::IsMatch($css, $pattern)) {
  $css = [regex]::Replace($css, $pattern, "$start`r`n$patch`r`n$end")
  Write-Host "Patch existente atualizado." -ForegroundColor Cyan
} else {
  $css = $css.TrimEnd() + "`r`n`r`n$start`r`n$patch`r`n$end`r`n"
  Write-Host "Patch adicionado ao final do App.css." -ForegroundColor Cyan
}

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Espaçamento das Configurações de segurança corrigido." -ForegroundColor Green
Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
Write-Host ""
