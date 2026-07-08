KPassword v0.7.1 - hotfix login com barra de opções real e temas aplicados

Corrige:
- A tela de login ainda parecia app dentro do app.
- As opções de idioma/tema/cofre ficaram escondidas em Ajustes rápidos.
- O tema não parecia aplicar na tela de login.
- O idioma estava dentro de um container desnecessário.
- A logo/fallback KP aparecia duplicada.

Ajuste:
- Remove o botão/accordion "Ajustes rápidos".
- Mostra idioma, tema, cofre, novo cofre e restaurar backup direto na barra superior.
- O idioma aparece como controle compacto, sem rótulo "Idioma".
- Tema aplica visualmente na tela de login: escuro, claro e misto.
- Remove duplicidade visual da marca.
- Reduz títulos e mantém a tela usando a área toda.

Não altera:
- Cofre
- Criptografia
- PIN/biometria do computador
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas/traduções

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-login-toolbar-temas*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
