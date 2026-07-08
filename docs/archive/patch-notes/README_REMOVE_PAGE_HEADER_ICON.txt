KPassword - remover ícone duplicado do cabeçalho da página

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-remove-page-header-icon*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
powershell -ExecutionPolicy Bypass -File ".\tools\remove-page-header-icon.ps1"
npm run tauri dev

Alteração:
- Remove visualmente o ícone do cabeçalho das páginas.
- Mantém o ícone no menu lateral como botão de abrir/fechar.
- Mantém o ícone nativo na barra superior do Windows, barra de tarefas e bandeja.
- Faz backup automático do App.css.
