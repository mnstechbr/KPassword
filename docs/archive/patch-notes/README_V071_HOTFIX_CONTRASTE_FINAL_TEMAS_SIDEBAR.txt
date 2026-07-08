KPassword v0.7.1 - hotfix contraste final dos temas e sidebar

Corrige:
- Tema Claro/Misto com containers claros usando texto branco.
- Tema Claro/Misto com containers escuros usando texto escuro/cinza apagado.
- Botões claros com texto branco.
- Botões desativados ilegíveis.
- Painel de PIN/biometria do computador com texto claro em fundo claro.
- Cofre atual e seletor de idioma com contraste inconsistente.
- Logo do menu lateral fechada desalinhada.

Ajuste:
- Superfície clara = texto escuro.
- Superfície escura = texto claro.
- Botões claros usam texto azul/escuro.
- Botões vermelhos ativos continuam com texto branco.
- Botões desativados ficam claros, mas legíveis.
- Sidebar continua escura nos temas claro/misto, com texto/ícones claros.
- A logo do botão de recolher/abrir menu volta ao centro sem translateX.

Também reforça o Analítico:
- Sinais de atenção ficam em lista mais objetiva.
- Cores de risco/aviso com contraste correto no claro/misto.

Não altera:
- Cofre
- Criptografia
- PIN/biometria em si
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas
- Login aprovado

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-contraste-final-temas-sidebar*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
