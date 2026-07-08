KPassword v0.7.1 - hotfix temas, analítico e menu lateral

Ajustes:
- Remove o nome KPassword do menu lateral, mantendo só o botão/logo de recolher.
- Adiciona uma guarda de contraste para Escuro, Claro e Misto.
- Corrige containers claros com texto claro e containers escuros com texto escuro/cinza apagado.
- Mantém a sidebar escura no modo claro/misto, com textos legíveis.
- Refaz a página Analítico para fazer mais sentido:
  - status do cofre
  - total do cofre atual
  - sinais reais que precisam de atenção
  - lista curta de itens críticos clicáveis
  - resumo compacto por tipo de item
  - proteção local resumida

Não altera:
- Cofre
- Criptografia
- PIN/biometria
- TOTP
- Multi-cofres
- Backup
- Updater
- Login aprovado

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-temas-analitico-lateral*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
