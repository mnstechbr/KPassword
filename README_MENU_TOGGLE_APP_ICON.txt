KPassword - trocar botão do menu lateral pelo ícone do app

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-menu-toggle-app-icon*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
powershell -ExecutionPolicy Bypass -File ".\tools\menu-toggle-app-icon.ps1"
npm run tauri dev

Alterações:
- Troca o ícone de hambúrguer pelo ícone oficial do KPassword.
- Mantém o botão clicável para abrir/fechar o menu.
- Remove o ícone duplicado ao lado do nome KPassword no menu aberto.
- Mantém tooltip: abrir/fechar menu lateral.
- Faz backup automático de App.tsx e App.css antes de alterar.
