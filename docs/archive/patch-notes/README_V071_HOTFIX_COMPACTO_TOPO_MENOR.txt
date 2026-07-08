KPassword v0.7.1 - hotfix modo compacto com topo menor

Corrige:
- Quando a janela fica muito estreita, o cabeçalho ocupava espaço demais.
- O conteúdo começava muito embaixo e parecia que havia uma área vazia gigante.
- A navegação inferior também ficava alta demais para uma janela pequena.

Ajuste:
- Compacta o cabeçalho apenas no modo estreito.
- Reduz título, eyebrow, cofre atual, idioma e botão +.
- Reduz padding da página no modo compacto.
- Reduz altura dos botões da navegação inferior.
- Mantém o desktop aprovado intacto.
- Mantém os temas e contraste já ajustados.

Não altera:
- Cofre
- Criptografia
- PIN/biometria
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas
- Login aprovado

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-compacto-topo-menor*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
