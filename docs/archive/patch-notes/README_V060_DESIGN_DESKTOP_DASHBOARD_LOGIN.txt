KPassword v0.6.0 - ajuste visual do login e dashboard

Corrige o feedback:
- Dashboard estava visualmente fraca/sem hierarquia.
- Login parecia app mobile dentro de container desktop.
- Login exigia scroll para visualizar tudo.

Ajustes:
- Login vira layout desktop em duas colunas quando há espaço.
- Idioma fica no topo.
- Logo/título/descrição ficam como bloco de apresentação.
- Formulário fica em painel próprio.
- Seletor de cofre fica abaixo do formulário, sem forçar scroll interno.
- Em tela menor, volta para layout vertical responsivo.
- Dashboard recebe grid mais organizado, cards melhores, hierarquia visual e cards largos padronizados.
- Mantém identidade visual do KPassword.
- Não altera regra de cofre, Windows Hello, TOTP, multi-cofres, criptografia, updater ou idiomas.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v060-design-desktop-dashboard-login*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
