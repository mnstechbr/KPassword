KPassword - ajuste fino do tamanho do ícone

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-icon-final-size-tuning*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\boost-native-icon.ps1" -BoostPercent 0.12 -MaxFillPercent 0.985

npm run tauri dev

Alterações:
- Ícones dentro do app aumentados cerca de 5% a 7%.
- Script para aumentar app-icon.png em cerca de 12%, limitado a 98,5% do canvas.
- O script refaz os ícones nativos com npm run tauri icon app-icon.png.
- Faz backup automático do app-icon.png antes de alterar.

Se ainda faltar um pouco:
powershell -ExecutionPolicy Bypass -File ".\tools\boost-native-icon.ps1" -BoostPercent 0.15 -MaxFillPercent 0.995
npm run tauri dev

Não rode várias vezes seguidas sem verificar visualmente, porque o ícone pode começar a ficar grande demais ou próximo demais das bordas.
