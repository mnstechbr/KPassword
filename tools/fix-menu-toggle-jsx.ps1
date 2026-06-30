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
Copy-Item $AppPath "$AppPath.backup-fix-menu-jsx-$timestamp" -Force
Copy-Item $CssPath "$CssPath.backup-fix-menu-jsx-$timestamp" -Force

$app = Get-Content $AppPath -Raw -Encoding UTF8

if ($app -notmatch "AppLogo") {
  throw "Componente AppLogo não encontrado. Aplique primeiro o pacote de ícone na interface."
}

$newSidebarHeader = @'
        <div className="sidebarBrand">
          <button
            className="sidebarToggle"
            onClick={() => setSidebarExpanded((current) => !current)}
            title={sidebarExpanded ? "Fechar menu lateral" : "Abrir menu lateral"}
            aria-label={sidebarExpanded ? "Fechar menu lateral" : "Abrir menu lateral"}
          >
            <AppLogo size="md" />
          </button>

          <div className="brandText">
            <strong>KPassword</strong>
            <span>Cofre local</span>
          </div>
        </div>

        <nav className="navList">
'@

# Corrige tudo entre sidebarBrand e navList, inclusive o JSX quebrado anterior.
$pattern = '(?s)\s*<div className="sidebarBrand">.*?<nav className="navList">\s*'
if ($app -notmatch $pattern) {
  throw "Bloco sidebarBrand/navList não encontrado para correção."
}

$app = [regex]::Replace($app, $pattern, "`r`n$newSidebarHeader", 1)

Set-Content -Path $AppPath -Value $app -Encoding UTF8

$css = Get-Content $CssPath -Raw -Encoding UTF8

$patch = @'

/* Correção segura: ícone do KPassword como botão do menu lateral */
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

.sidebarOpen .brandText {
  padding-left: 0;
}

'@

if ($css -notmatch "Correção segura: ícone do KPassword como botão do menu lateral") {
  $css = $css.TrimEnd() + "`r`n" + $patch
}

Set-Content -Path $CssPath -Value $css -Encoding UTF8

Write-Host ""
Write-Host "JSX do menu lateral corrigido com sucesso." -ForegroundColor Green
Write-Host "Backup App.tsx: $AppPath.backup-fix-menu-jsx-$timestamp" -ForegroundColor Yellow
Write-Host "Backup App.css: $CssPath.backup-fix-menu-jsx-$timestamp" -ForegroundColor Yellow
Write-Host ""
