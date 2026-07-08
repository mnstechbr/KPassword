KPassword - menu com ícones, drag/drop, confirmação customizada e clipboard 1 min

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-ux-menu-drag-confirm-clipboard*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Alterações:
- Menu lateral padronizado com ícones.
- Tooltip no hover dos botões do menu.
- Menu continua fechado por padrão.
- Credenciais podem ser movidas segurando e arrastando para cima/baixo.
- Ordem manual é salva no cofre criptografado.
- Confirmações deixam de usar window.confirm e passam a usar modal visual do KPassword.
- Favoritar continua sem confirmação.
- Clipboard atual é limpo depois de 1 minuto.
- Mensagem "Cofre desbloqueado localmente" removida.
- Caminho do banco removido da tela bloqueada/login.
- Mensagens antigas de criação/desbloqueio não ficam presas na tela.
