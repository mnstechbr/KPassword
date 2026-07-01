KPassword v0.7.1 - hotfix scroll login em menor resolução

Corrige:
- Ao reduzir a janela ao mínimo, a tela de login reorganizava os elementos para baixo,
  mas não permitia rolar para ver tudo.

Ajuste:
- A tela bloqueada passa a permitir scroll vertical quando necessário.
- Mantém o layout desktop em resolução normal.
- Compacta levemente logo, título, espaçamentos e painel quando a altura é muito pequena.
- Não altera demais telas.

Não altera:
- Cofre
- Criptografia
- PIN/biometria
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas
- Design aprovado do login em resolução normal

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-scroll-login-menor-resolucao*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
