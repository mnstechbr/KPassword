KPassword v0.7.1 - tray menu completo/compacto e ícone +10%

Adiciona no clique direito da bandeja:
- Abrir APP Completo
- Abrir APP Compacto
- Sair

Também tenta aumentar em ~10% o conteúdo visual do app-icon.png e regenera os ícones do Tauri.

Observações:
- O Windows limita o tamanho real do ícone da bandeja. O ajuste aumenta o conteúdo dentro do ícone, o que ajuda quando havia margem sobrando.
- Se o ícone já estiver quase no limite, o script não força para não cortar a logo.
- Pode ser necessário fechar e abrir o app novamente para ver o ícone atualizado na bandeja.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-tray-menu-compacto-icone*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\update-v071-tray-menu-icon.ps1"

npm run build
npm run tauri dev
