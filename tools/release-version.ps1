param(
  [Parameter(Mandatory = $true)] [string]$Version,
  [string]$Message = "release: preparar versao $Version"
)

$ErrorActionPreference = "Stop"

$Project = "C:\Projetos\KPassword"
Set-Location $Project

Write-Host ""
Write-Host "KPassword release v$Version - validação segura" -ForegroundColor Cyan
Write-Host ""
Write-Host "Este script não faz git add, commit, push, checkout, restore ou clean." -ForegroundColor Yellow
Write-Host "Ele apenas valida o projeto e mostra os próximos comandos manuais." -ForegroundColor Yellow

$SensitiveFiles = Get-ChildItem $Project -Recurse -File -Include *.kpvault,*.kphello,*.kppass,*.key,*.pfx,*.p12,*.pem -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\src-tauri\\target\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\dist-release\\' -and
    $_.FullName -notmatch '\\.git\\'
  }

if ($SensitiveFiles) {
  Write-Host "Arquivos sensíveis encontrados dentro do projeto. Nada será preparado:" -ForegroundColor Red
  $SensitiveFiles | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
  throw "Remova cofres/segredos locais do diretório do projeto antes da release."
}

npm run build

powershell -ExecutionPolicy Bypass -File ".\tools\audit-project.ps1"

Write-Host ""
Write-Host "Status atual do Git:" -ForegroundColor Cyan
git status --short --branch

Write-Host ""
Write-Host "Validação concluída. Próximos passos manuais sugeridos:" -ForegroundColor Green
Write-Host ""
Write-Host "git status --short --branch" -ForegroundColor White
Write-Host "git add CAMINHOS_ESPECIFICOS" -ForegroundColor White
Write-Host "git commit -m \"$Message\"" -ForegroundColor White
Write-Host "git push" -ForegroundColor White
Write-Host "powershell -ExecutionPolicy Bypass -File \".\tools\fix-updater-v030-build.ps1\" -Version \"$Version\"" -ForegroundColor White
Write-Host "npm run release:hash -- --ReleaseDir \".\dist-release\v$Version\"" -ForegroundColor White
Write-Host "npm run release:validate -- --ReleaseDir \".\dist-release\v$Version\"" -ForegroundColor White
