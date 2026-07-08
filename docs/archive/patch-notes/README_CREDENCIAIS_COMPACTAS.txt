KPassword - Credenciais como tela principal e layout compacto

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-credentials-main-compact*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Incluído:
- Tela principal agora abre direto em Credenciais.
- Cards de credencial compactos para caber mais itens na tela.
- Clique em uma credencial abre painel com detalhes completos.
- Confirmação ao criar credencial.
- Confirmação ao editar credencial.
- Confirmação ao excluir credencial.
- Confirmação ao favoritar/remover favorito.
- Confirmação ao criar backup manual.
- Ajustes de espaçamento entre containers, textos, botões e campos.
- Layout responsivo para resize da janela sem sumir conteúdo.
