KPassword v0.7.2 - fix JSON/BOM

Corrige:
- ConvertFrom-Json falhando no package-lock.json
- Vite/PostCSS falhando com "Unexpected token BOM" ao ler package.json/config
- Mantém versão 0.7.2 em package.json, package-lock.json e tauri.conf.json

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v072-fix-json-bom-script*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-v072-json-bom-version.ps1"

npm run build
npm run tauri dev

Depois de validar:
git add .
git commit -m "Adiciona documentacao limpeza e checklist de manutencao"
git push
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "0.7.2"
