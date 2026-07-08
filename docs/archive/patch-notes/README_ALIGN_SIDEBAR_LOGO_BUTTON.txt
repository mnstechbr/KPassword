KPassword - alinhar botão do ícone do menu lateral

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-align-sidebar-logo-button*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\align-sidebar-logo-button.ps1"

npm run tauri dev

O que altera:
- Alinha o botão do ícone KPassword com os demais botões do menu lateral.
- Padroniza largura/altura em 56x56.
- Remove borda/sombra que deixava o botão diferente.
- Mantém o ícone como botão de esconder/expandir menu.
- Não altera updater, build, GitHub Release ou lógica do app.
