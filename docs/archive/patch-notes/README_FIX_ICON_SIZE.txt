KPassword - corrigir ícone pequeno

Este pacote contém um script PowerShell que:
- Faz backup do app-icon.png atual.
- Remove margem transparente.
- Redimensiona o conteúdo visível para ocupar 92% do canvas 1024x1024.
- Salva novamente como app-icon.png.
- Copia para public/app-icon.png.
- Roda npm run tauri icon app-icon.png.

Como usar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-icon-size*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
powershell -ExecutionPolicy Bypass -File ".\tools\fix-icon-padding.ps1"
npm run tauri dev

Se quiser preencher ainda mais, rode com 95%:
powershell -ExecutionPolicy Bypass -File ".\tools\fix-icon-padding.ps1" -FillPercent 0.95

Observação:
Se o app-icon.png tiver fundo sólido preenchendo 1024x1024 e o desenho estiver pequeno dentro desse fundo, este script não conseguirá detectar a margem, porque tecnicamente tudo é conteúdo. Nesse caso, gere novamente a imagem com o símbolo/placa ocupando 90% a 95% do canvas.
