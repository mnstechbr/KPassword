KPassword - gerar instalador com nome único para verificar cache de ícone

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-build-installer-unique-icon-check*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\build-installer-unique-icon-check.ps1"

O que o script faz:
- Garante bundle.windows.nsis.installerIcon = "icons/icon.ico".
- Garante bundle.windows.nsis.uninstallerIcon = "icons/icon.ico".
- Salva tauri.conf.json em UTF-8 sem BOM.
- Regenera os ícones com npm run tauri icon app-icon.png.
- Apaga o bundle antigo.
- Gera o instalador.
- Cria uma cópia com "-iconcheck-YYYYMMDD-HHMMSS" no nome para evitar cache do Windows Explorer.
- Abre a pasta NSIS.

Verifique primeiro o arquivo com "-iconcheck-" no nome.
