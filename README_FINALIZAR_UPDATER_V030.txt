KPassword - finalizar updater v0.3.0

Situação:
- A release v0.2.0 já foi criada.
- O código já estava parcialmente em v0.3.0, mas ainda tinha placeholders SEU_USUARIO_GITHUB/SEU_REPO_GITHUB.
- Este pacote corrige para mnstechbr/KPassword, gera build assinado e monta a pasta para release v0.3.0.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-finalizar-updater-v030*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\finalizar-updater-v030.ps1"

Depois:
1. Abra https://github.com/mnstechbr/KPassword/releases/new
2. Tag: v0.3.0
3. Título: KPassword v0.3.0
4. Anexe os arquivos de C:\Projetos\KPassword\dist-release\v0.3.0
5. Publique a release
6. Instale manualmente o KPassword-Setup-v0.3.0.exe uma única vez.

A partir da v0.3.0, o botão Verificar atualizações deve funcionar para v0.3.1+.
