KPassword v0.7.1 - hotfix scroll sem mover layout

Corrige:
- O hotfix anterior moveu/reorganizou o painel de login em altura pequena.
- O desejado era apenas permitir rolagem quando o layout já tivesse conteúdo abaixo da área visível.

Este pacote:
- Volta para o visual aprovado do login anterior.
- Remove o patch anterior de scroll que mexia em breakpoints/posicionamento.
- Adiciona apenas overflow-y/scroll na tela bloqueada.
- Não altera grid, colunas, logo, título, painel de login ou breakpoints.

Não altera:
- Cofre
- Criptografia
- PIN/biometria
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-scroll-login-sem-mover-layout*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
