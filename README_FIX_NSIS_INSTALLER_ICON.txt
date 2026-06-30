KPassword - corrigir ícone do instalador NSIS

Problema:
- O app e o ícone nativo estavam funcionando.
- O setup gerado em src-tauri\target\release\bundle\nsis não estava usando o ícone.
- Faltava configurar bundle.windows.nsis.installerIcon no tauri.conf.json.

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-nsis-installer-icon*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-nsis-installer-icon.ps1"

npm run tauri build

Get-ChildItem ".\src-tauri\target\release\bundle\nsis" -Recurse -Include *.exe |
  Sort-Object LastWriteTime -Descending |
  Select-Object FullName, LastWriteTime

O script:
- Roda npm run tauri icon app-icon.png.
- Confirma se src-tauri\icons\icon.ico existe.
- Atualiza tauri.conf.json.
- Adiciona bundle.windows.nsis.installerIcon = "icons/icon.ico".
- Adiciona bundle.windows.nsis.uninstallerIcon = "icons/icon.ico".
- Remove bundle antigo para evitar abrir instalador velho.
- Faz backup automático do tauri.conf.json.
