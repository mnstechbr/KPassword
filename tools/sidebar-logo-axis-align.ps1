param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $CssPath "$CssPath.backup-sidebar-logo-axis-$timestamp" -Force

$css = Get-Content $CssPath -Raw -Encoding UTF8

# Remove patches anteriores relacionados ao alinhamento do logo para evitar conflito/duplicação.
$patterns = @(
  '(?s)\r?\n/\* Alinhamento final do ícone/botão do menu lateral com os demais botões \*/.*?(?=\r?\n/\*|\z)',
  '(?s)\r?\n/\* Correção pontual: alinhar somente o botão KPassword do menu lateral \*/.*?(?=\r?\n/\*|\z)',
  '(?s)\r?\n/\* Alinhamento por eixo: somente o botão KPassword no menu fechado \*/.*?(?=\r?\n/\*|\z)'
)

foreach ($pattern in $patterns) {
  $css = [regex]::Replace($css, $pattern, '')
}

$patch = @'

/* Alinhamento por eixo: somente o botão KPassword no menu fechado */
.sidebarClosed .sidebarBrand {
  width: 100% !important;
  box-sizing: border-box;
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle {
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  display: grid !important;
  place-items: center !important;
  justify-content: center !important;
  align-items: center !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  transform: none !important;
  background: transparent !important;
  box-shadow: none !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle:hover {
  background: transparent !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle .appLogo.md {
  margin: 0 auto !important;
  justify-self: center !important;
  align-self: center !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle .appLogo.md img {
  transform: none !important;
}

'@

$css = $css.TrimEnd() + "`r`n" + $patch

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Alinhamento do botão KPassword corrigido por eixo central." -ForegroundColor Green
Write-Host "Somente o bloco sidebarClosed .sidebarBrand .sidebarToggle foi afetado." -ForegroundColor Green
Write-Host "Backup criado em: $CssPath.backup-sidebar-logo-axis-$timestamp" -ForegroundColor Yellow
Write-Host ""
