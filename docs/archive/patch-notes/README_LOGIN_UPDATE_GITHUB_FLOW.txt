KPassword - login compacto, restaurar backup em popup e atualizações simplificadas

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-login-update-github-flow*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Alterações:
- Tela de login voltou a ficar compacta.
- Restauração de backup virou texto clicável "Restaurar backup".
- Ao clicar, abre popup para senha do backup e arquivo .kpvault.
- Popup fecha no X ou clicando fora.
- Configurações não pedem mais usuário/organização/repositório para o usuário.
- Container virou "Procurar por atualizações".
- Mostra versão instalada e status do canal.
- O app informa quando GitHub Releases ainda não está configurado.
