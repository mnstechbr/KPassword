KPassword - UX de credenciais, popup e menu lateral recolhido

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-ux-credentials-popup-sidebar*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Alterações:
- Favoritar sem confirmação.
- Estrela maior e mais visível.
- Credenciais em lista simples, uma por linha.
- Linha mostra nome, usuário, senha escondida, categoria/força quando couber e ações principais.
- Excluir removido da linha; aparece apenas no popup completo.
- Detalhe da credencial agora abre em popup.
- Popup fecha no X ou clicando fora.
- Pesquisa ampla: nome, usuário, senha, site, categoria, favorito e observações.
- Menu lateral fechado por padrão.
- Botão de menu abre/fecha o painel lateral.
- Responsividade revisada para resize da janela.
