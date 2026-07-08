KPassword - alinhar somente o botão do ícone KPassword no menu fechado

Análise visual:
- A coluna do menu fechado tem cerca de 92 px de largura.
- Os botões normais do menu estão centralizados aproximadamente no eixo X=46.
- O ícone KPassword do topo estava centralizado mais à esquerda, aproximadamente X=37/38.
- A correção não deve mexer nos botões normais; deve centralizar só o botão do logo no mesmo eixo da coluna.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-sidebar-logo-axis-align*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\sidebar-logo-axis-align.ps1"

npm run tauri dev

O que faz:
- Remove patches anteriores de alinhamento do botão KPassword.
- Não altera .navList button.
- Não altera .lockButton.
- Não altera tamanhos dos botões normais.
- Centraliza apenas .sidebarClosed .sidebarBrand .sidebarToggle usando width: 100% e place-items: center.
