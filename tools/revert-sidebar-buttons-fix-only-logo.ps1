param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $CssPath "$CssPath.backup-revert-sidebar-buttons-$timestamp" -Force

$css = Get-Content $CssPath -Raw -Encoding UTF8

# Remove o patch agressivo anterior que alterou também os botões normais do menu.
$css = [regex]::Replace(
  $css,
  '(?s)\r?\n/\* Alinhamento final do ícone/botão do menu lateral com os demais botões \*/.*?(?=\r?\n/\*|\z)',
  ''
)

# Remove uma possível versão anterior da correção pontual para não duplicar.
$css = [regex]::Replace(
  $css,
  '(?s)\r?\n/\* Correção pontual: alinhar somente o botão KPassword do menu lateral \*/.*?(?=\r?\n/\*|\z)',
  ''
)

$patch = @'

/* Correção pontual: alinhar somente o botão KPassword do menu lateral */
.sidebarClosed .sidebarBrand {
  display: flex;
  justify-content: center;
  align-items: center;
}

.sidebarClosed .sidebarBrand .sidebarToggle {
  margin-left: auto !important;
  margin-right: auto !important;
  align-self: center !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle .appLogo.md {
  margin-left: auto !important;
  margin-right: auto !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle:focus,
.sidebarClosed .sidebarBrand .sidebarToggle:active {
  outline: none !important;
  box-shadow: none !important;
}

'@

$css = $css.TrimEnd() + "`r`n" + $patch

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Patch agressivo removido e correção pontual aplicada." -ForegroundColor Green
Write-Host "Backup criado em: $CssPath.backup-revert-sidebar-buttons-$timestamp" -ForegroundColor Yellow
Write-Host ""
