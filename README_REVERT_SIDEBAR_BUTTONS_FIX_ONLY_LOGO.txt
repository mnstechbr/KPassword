KPassword - reverter alteração agressiva dos botões do menu

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-revert-sidebar-buttons-fix-only-logo*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\revert-sidebar-buttons-fix-only-logo.ps1"

npm run tauri dev

O que faz:
- Remove o patch anterior que mexeu em todos os botões do menu.
- Restaura o comportamento visual dos botões normais.
- Aplica alinhamento somente no botão/ícone KPassword do topo.
- Não mexe no updater, release, build ou lógica.
