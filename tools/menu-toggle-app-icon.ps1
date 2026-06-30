param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$AppPath = Join-Path $Project "src\App.tsx"
$CssPath = Join-Path $Project "src\App.css"

if (-not (Test-Path $AppPath)) {
  throw "src\App.tsx não encontrado em $Project"
}

if (-not (Test-Path $CssPath)) {
  throw "src\App.css não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $AppPath "$AppPath.backup-menu-icon-$timestamp" -Force
Copy-Item $CssPath "$CssPath.backup-menu-icon-$timestamp" -Force

$app = Get-Content $AppPath -Raw -Encoding UTF8

if ($app -notmatch "function AppLogo" -and $app -notmatch "const AppLogo") {
  throw "Componente AppLogo não encontrado no App.tsx. Aplique primeiro o pacote de ícone na interface."
}

# Troca o conteúdo visual do botão sidebarToggle de hambúrguer para o ícone do app.
$pattern = '(?s)(<button\s+className="sidebarToggle"[^>]*>).*?(</button>)'
$replacement = '$1' + "`r`n            <AppLogo size=""md"" />`r`n          " + '$2'
$app = [regex]::Replace($app, $pattern, $replacement, 1)

# Remove o ícone duplicado ao lado do nome quando existir brandIdentity.
$app = $app -replace '\r?\n\s*<AppLogo size="sm" />\r?\n\s*(<div className="brandText">)', "`r`n            `$1"

Set-Content -Path $AppPath -Value $app -Encoding UTF8

$css = Get-Content $CssPath -Raw -Encoding UTF8

$patch = @'

/* Menu toggle usando o ícone oficial do KPassword */
.sidebarToggle {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: inherit;
  padding: 0;
  box-shadow: none;
}

.sidebarToggle:hover {
  background: rgba(125, 211, 252, 0.1);
}

.sidebarToggle .appLogo.md {
  width: 42px;
  height: 42px;
  margin: 0;
}

.sidebarToggle .appLogo.md img {
  transform: none;
  object-fit: contain;
}

.sidebarClosed .sidebarBrand {
  justify-content: center;
}

.sidebarClosed .sidebarToggle {
  width: 52px;
  height: 52px;
  margin: 0 auto;
}

.sidebarOpen .sidebarBrand {
  align-items: center;
}

.sidebarOpen .brandIdentity {
  min-width: 0;
}

.sidebarOpen .brandText {
  padding-left: 0;
}

'@

if ($css -notmatch "Menu toggle usando o ícone oficial do KPassword") {
  $css = $css.TrimEnd() + "`r`n" + $patch
}

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "Menu lateral ajustado com sucesso." -ForegroundColor Green
Write-Host "Backup App.tsx: $AppPath.backup-menu-icon-$timestamp" -ForegroundColor Yellow
Write-Host "Backup App.css: $CssPath.backup-menu-icon-$timestamp" -ForegroundColor Yellow
Write-Host ""
