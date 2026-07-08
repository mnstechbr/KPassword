KPassword v0.8.2 - hotfix REAL de contraste Claro/Misto

Este pacote corrige o erro do hotfix anterior:
ele usava seletores que nao batiam com a estrutura real do app.

Agora usa os seletores reais:
- :root[data-theme="light"]
- :root[data-theme="mixed"]
- .windowsHelloButton
- .rowActions button
- .trashActions .dangerButton
- .detailActions button
- .attachmentActions button
- .historyActions button

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v082-hotfix-contraste-real-claro-misto*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\apply-v082-real-contrast-light-mixed.ps1"

npm run build
npm run tauri dev
