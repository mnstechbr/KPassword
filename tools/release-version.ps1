param(
  [Parameter(Mandatory = $true)] [string]$Version,
  [string]$Message = "Manutencao documentacao e estabilidade"
)

$ErrorActionPreference = "Stop"

$Project = "C:\Projetos\KPassword"
Set-Location $Project

Write-Host ""
Write-Host "KPassword release v$Version" -ForegroundColor Cyan
Write-Host ""

$SensitiveFiles = Get-ChildItem $Project -Recurse -File -Include *.kpvault,*.kphello,*.kppass -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\src-tauri\\target\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\dist-release\\'
  }

if ($SensitiveFiles) {
  Write-Host "Arquivos sensiveis encontrados dentro do projeto. Nada foi commitado:" -ForegroundColor Red
  $SensitiveFiles | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
  throw "Remova cofres/segredos locais do diretorio do projeto antes da release."
}

npm run build

powershell -ExecutionPolicy Bypass -File ".\tools\audit-project.ps1"

git status --short

Write-Host ""
Write-Host "Gerando commit com staging explicito..." -ForegroundColor Cyan

$SafePaths = @(
  ".gitignore",
  ".github",
  "docs",
  "tools",
  "package.json",
  "package-lock.json",
  "README.md",
  "SECURITY.md",
  "TERMS.md",
  "CRYPTOGRAPHY.md",
  "RELEASE_CHECKLIST.md",
  "VULNERABILITY_POLICY.md",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "src",
  "src-tauri\Cargo.toml",
  "src-tauri\Cargo.lock",
  "src-tauri\tauri.conf.json",
  "src-tauri\build.rs",
  "src-tauri\capabilities",
  "src-tauri\src"
)

git add -- $SafePaths

git status --short

git commit -m $Message
git push

powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version $Version

explorer ".\dist-release\v$Version"
