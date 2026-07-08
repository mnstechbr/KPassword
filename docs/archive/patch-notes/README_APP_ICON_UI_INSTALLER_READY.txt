KPassword - ícone visual no app e pronto para gerar instalador

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-app-icon-ui-installer-ready*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
if (Test-Path "$Project\app-icon.png") {
  New-Item -ItemType Directory -Force "$Project\public" | Out-Null
  Copy-Item "$Project\app-icon.png" "$Project\public\app-icon.png" -Force
}
npm run tauri dev

Incluído:
- Ícone do app na tela de carregamento.
- Ícone do app na tela de criação de senha mestra.
- Ícone do app na tela de desbloqueio.
- Ícone do app na barra superior interna.
- Ícone do app no cabeçalho do menu lateral quando expandido.
- Fallback KP caso public/app-icon.png não exista.

Gerar instalador depois:

cd C:\Projetos\KPassword
npm run tauri icon app-icon.png
Copy-Item .\app-icon.png .\public\app-icon.png -Force
npm run tauri build
Get-ChildItem .\src-tauri\target\release\bundle -Recurse -Include *.exe,*.msi | Sort-Object LastWriteTime -Descending | Select-Object FullName, LastWriteTime
