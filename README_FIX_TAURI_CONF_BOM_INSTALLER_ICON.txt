KPassword - corrigir tauri.conf.json com BOM e ícone do instalador

Problema:
- Build falhou com:
  unable to parse JSON Tauri config file ... expected value at line 1 column 1

Causa provável:
- PowerShell salvou tauri.conf.json com BOM UTF-8.
- O parser do Tauri/Rust não aceitou o caractere invisível no início do arquivo.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-tauri-conf-bom-installer-icon*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-tauri-conf-bom-installer-icon.ps1"

O script:
- Remove BOM do tauri.conf.json.
- Se o JSON estiver realmente quebrado, restaura o backup mais recente.
- Configura bundle.windows.nsis.installerIcon.
- Configura bundle.windows.nsis.uninstallerIcon.
- Salva em UTF-8 sem BOM usando Node.
- Roda npm run tauri icon app-icon.png.
- Roda npm run tauri build.
- Lista os instaladores gerados.
