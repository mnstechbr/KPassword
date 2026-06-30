KPassword - ajustar apenas logo no menu fechado

Análise:
- Menu aberto está correto.
- Menu fechado está desalinhado apenas no botão/logo KPassword.
- Botões normais e botão Bloquear cofre estão no eixo correto.
- Correção: deslocar somente .sidebarClosed .sidebarBrand .sidebarToggle 9px para a direita.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-closed-sidebar-logo-offset*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-closed-sidebar-logo-offset.ps1"

npm run tauri dev

O que faz:
- Remove patches anteriores de alinhamento do logo.
- Não altera .navList button.
- Não altera .lockButton.
- Não altera menu aberto.
- Desloca apenas o botão/logo KPassword do menu fechado 9px para a direita.
