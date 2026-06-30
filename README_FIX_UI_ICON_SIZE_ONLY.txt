KPassword - corrigir tamanho do ícone dentro do app

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-ui-icon-size-only*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Alterações:
- Reduzido o ícone dentro do app.
- Removido scale extra no CSS.
- Não altera app-icon.png.
- Não altera ícones nativos da barra de tarefas, bandeja ou instalador.
