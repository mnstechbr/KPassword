KPassword v0.7.1 - fix robusto do menu da bandeja

Corrige o erro:
"Nao encontrei o bloco original das acoes do menu da bandeja para substituir."

Este script troca o menu da bandeja usando busca por posicao/estrutura, nao por bloco exato.

Novo clique direito na bandeja:
- Abrir APP Completo
- Abrir APP Compacto
- Sair

Tambem tenta aumentar em ~10% o conteudo visual do app-icon.png e regenera os icones do Tauri.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-fix-tray-menu-robusto*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP nao encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\update-v071-tray-menu-icon-robusto.ps1"

npm run build
npm run tauri dev

Importante:
- Feche totalmente o KPassword antigo pela bandeja antes de testar o novo menu.
- O menu da bandeja so muda no processo novo do app.
