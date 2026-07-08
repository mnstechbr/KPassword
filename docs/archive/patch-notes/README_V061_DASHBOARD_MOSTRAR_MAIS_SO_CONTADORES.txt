KPassword v0.6.1 - Dashboard Mostrar mais somente nos contadores

Corrige:
- O botão "Mostrar mais" deve esconder/mostrar apenas os contadores do print:
  Credencial, Nota segura, Cartão, Favoritas, Vencidas, A vencer, Fracas, Repetidas, Antigas e Lixeira.
- Os cards de Saúde, Atenção e Proteção continuam visíveis fora do dropdown.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v061-dashboard-mostrar-mais-so-contadores*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
