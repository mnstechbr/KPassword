KPassword v0.7.0 - hotfix Analítico limpo e botão adicionar compacto

Ajustes:
- Remove o container grande "Relatório de saúde" da página Analítico.
- Remove o abre/fecha de contadores do card "Itens salvos".
- O card "Itens salvos" volta a ser apenas um resumo visual.
- Mantém Saúde do cofre, Itens que precisam de atenção e Proteção local.
- O botão "Adicionar item" no topo vira apenas "+".
- O botão "+" tem tooltip conforme o idioma atual.

Não altera:
- Cofre
- Criptografia
- PIN/biometria do computador
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v070-hotfix-analitico-limpo-add-compacto*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
