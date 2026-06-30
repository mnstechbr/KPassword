param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $CssPath "$CssPath.backup-align-sidebar-logo-$timestamp" -Force

$css = Get-Content $CssPath -Raw -Encoding UTF8

$patch = @'

/* Alinhamento final do ícone/botão do menu lateral com os demais botões */
.sidebarBrand {
  width: 100%;
}

.sidebarClosed .sidebarBrand {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 18px 0 22px;
}

.sidebarOpen .sidebarBrand {
  display: flex;
  align-items: center;
}

.sidebarToggle {
  width: 56px !important;
  height: 56px !important;
  min-width: 56px !important;
  min-height: 56px !important;
  display: grid !important;
  place-items: center !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 16px !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none;
}

.sidebarToggle:hover {
  background: rgba(125, 211, 252, 0.1) !important;
}

.sidebarToggle:focus,
.sidebarToggle:active {
  outline: none !important;
  box-shadow: none !important;
}

.sidebarToggle:focus-visible {
  outline: 1px solid rgba(125, 211, 252, 0.45) !important;
  outline-offset: 2px;
}

.sidebarToggle .appLogo.md {
  width: 44px !important;
  height: 44px !important;
  margin: 0 !important;
}

.sidebarToggle .appLogo.md img {
  width: 44px !important;
  height: 44px !important;
  object-fit: contain !important;
  transform: none !important;
}

.sidebarClosed .navList {
  align-items: center;
}

.sidebarClosed .navList button,
.sidebarClosed .sidebarFooter .lockButton {
  width: 56px;
  height: 56px;
  min-width: 56px;
  min-height: 56px;
  margin-left: auto;
  margin-right: auto;
}

'@

if ($css -notmatch "Alinhamento final do ícone/botão do menu lateral") {
  $css = $css.TrimEnd() + "`r`n" + $patch
} else {
  Write-Host "Patch de alinhamento já existe no App.css. Nenhuma duplicação aplicada." -ForegroundColor Yellow
}

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Alinhamento do botão/ícone do menu lateral aplicado com sucesso." -ForegroundColor Green
Write-Host "Backup criado em: $CssPath.backup-align-sidebar-logo-$timestamp" -ForegroundColor Yellow
Write-Host ""
