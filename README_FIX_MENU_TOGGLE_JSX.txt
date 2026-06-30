KPassword - corrigir erro JSX do menu lateral

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-menu-toggle-jsx*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
powershell -ExecutionPolicy Bypass -File ".\tools\fix-menu-toggle-jsx.ps1"
npm run tauri dev

Correção:
- Corrige o JSX quebrado no cabeçalho do menu lateral.
- Mantém o ícone do KPassword como botão de abrir/fechar menu.
- Remove a estrutura duplicada/quebrada anterior.
- Faz backup automático de App.tsx e App.css.
