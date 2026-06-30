param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $CssPath "$CssPath.backup-remove-page-header-icon-$timestamp" -Force

$css = Get-Content $CssPath -Raw -Encoding UTF8

$patch = @'

/* Remove o ícone duplicado do cabeçalho das páginas */
.topbarTitle .appLogo {
  display: none !important;
}

.topbarTitle {
  gap: 0 !important;
}

'@

if ($css -notmatch "Remove o ícone duplicado do cabeçalho das páginas") {
  $css = $css.TrimEnd() + "`r`n" + $patch
}

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Icone do cabecalho das paginas removido com sucesso." -ForegroundColor Green
Write-Host "Backup App.css: $CssPath.backup-remove-page-header-icon-$timestamp" -ForegroundColor Yellow
Write-Host ""
