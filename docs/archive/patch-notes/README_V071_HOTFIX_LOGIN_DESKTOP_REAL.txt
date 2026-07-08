KPassword v0.7.1 - hotfix login desktop real

Corrige o feedback:
- A tela de login parecia um app dentro de outro app.
- Havia um container grande centralizado usando pouco a janela.
- As fontes ficaram grandes demais.
- A logo apareceu duplicada.
- Ajustes rápidos abria atrás do painel de login.

O ajuste:
- Remove o container externo visual do login.
- Usa a área inteira da janela.
- Mantém uma única marca/logo no topo.
- Reduz e refina os tamanhos dos títulos.
- Organiza hero à esquerda e painel à direita sem "card gigante".
- Ajustes rápidos abre por cima de tudo.
- Mantém responsividade para janelas menores.

Não altera:
- Cofre
- Criptografia
- PIN/biometria do computador
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas
- Demais telas desbloqueadas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-login-desktop-real*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
