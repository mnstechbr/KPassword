KPassword - revisão menu, reordenação, Segurança & Backup e Configurações

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-settings-theme-reorder-polish*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Alterações:
- Corrigido alinhamento do botão "Bloquear cofre" no menu lateral fechado.
- Removido drag/drop instável.
- Adicionados botões pequenos ↑ e ↓ para mover credenciais.
- Botões de mover funcionam apenas sem busca ativa, para evitar reorganização confusa em lista filtrada.
- Favoritos sobem acima das credenciais não favoritadas.
- Senhas mascaradas ficam sempre com o mesmo tamanho.
- Página Segurança & Backup com caminhos ocultos por padrão.
- Caminhos aparecem temporariamente por 30 segundos.
- Espaçamento entre backups e botão "Criar backup agora" revisado.
- Criada página Configurações.
- Temas: escuro, claro e misto.
- Acessibilidade: fonte maior, reduzir animações e lista compacta.
- Ação sensível de restaurar aparência pede confirmação.
- Scroll continua funcionando, mas as barras ficam invisíveis.
