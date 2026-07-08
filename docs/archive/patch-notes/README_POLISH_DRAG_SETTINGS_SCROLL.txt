KPassword - ajustes de menu, drag/drop, segurança & backup e scroll invisível

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-polish-drag-settings-scroll*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Alterações:
- Botão "Bloquear cofre" padronizado com os demais itens do menu lateral.
- Menu lateral com tooltips e ícones mantidos.
- Drag/drop corrigido usando o pegador "⋮⋮" da linha.
- Favoritos sobem acima das credenciais não favoritadas.
- Senhas mascaradas agora usam tamanho fixo: ••••••••••••.
- Página Segurança & Backup revisada.
- Caminhos locais ficam ocultos por padrão e só aparecem por 30 segundos.
- Containers da página de segurança com espaçamento e alinhamento revisados.
- Barras de rolagem ficam invisíveis, mas o scroll continua funcionando.
- Clipboard atual continua sendo limpo em 1 minuto.
Observação: o histórico Win+V é controlado pelo Windows; o app limpa o clipboard atual, mas não consegue garantir apagar itens já gravados no histórico do sistema.
