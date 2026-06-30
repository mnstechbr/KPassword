param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $CssPath "$CssPath.backup-closed-sidebar-logo-offset-$timestamp" -Force

$css = Get-Content $CssPath -Raw -Encoding UTF8

# Remove tentativas anteriores de alinhamento do logo para evitar conflito.
$patterns = @(
  '(?s)\r?\n/\* Alinhamento final do ícone/botão do menu lateral com os demais botões \*/.*?(?=\r?\n/\*|\z)',
  '(?s)\r?\n/\* Correção pontual: alinhar somente o botão KPassword do menu lateral \*/.*?(?=\r?\n/\*|\z)',
  '(?s)\r?\n/\* Alinhamento por eixo: somente o botão KPassword no menu fechado \*/.*?(?=\r?\n/\*|\z)',
  '(?s)\r?\n/\* Ajuste final: deslocar somente o botão KPassword no menu fechado \*/.*?(?=\r?\n/\*|\z)'
)

foreach ($pattern in $patterns) {
  $css = [regex]::Replace($css, $pattern, '')
}

$patch = @'

/* Ajuste final: deslocar somente o botão KPassword no menu fechado */
.sidebarClosed .sidebarBrand .sidebarToggle {
  transform: translateX(9px) !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle .appLogo.md {
  transform: none !important;
}

.sidebarClosed .sidebarBrand .sidebarToggle .appLogo.md img {
  transform: none !important;
}

/* Menu aberto permanece com o alinhamento original */
.sidebarOpen .sidebarBrand .sidebarToggle {
  transform: none !important;
}

'@

$css = $css.TrimEnd() + "`r`n" + $patch

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Ajuste aplicado: apenas o botão KPassword no menu fechado foi deslocado 9px para a direita." -ForegroundColor Green
Write-Host "Menu aberto e botões normais não foram alterados." -ForegroundColor Green
Write-Host "Backup criado em: $CssPath.backup-closed-sidebar-logo-offset-$timestamp" -ForegroundColor Yellow
Write-Host ""
