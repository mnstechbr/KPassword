KPassword v0.7.1 - hotfix contraste no popup Adicionar/Editar item

Corrige:
- O guarda de contraste dos temas Claro/Misto não tinha sido aplicado corretamente
  dentro do popup de Adicionar/Editar item.
- Campos, selects, labels, gerador de senha e botões podiam ficar com texto claro
  em fundo claro ou texto escuro em fundo escuro.

Ajuste:
- Tema Claro/Misto no popup:
  - modal claro com texto escuro
  - inputs/selects/textarea claros com texto escuro
  - botões claros com texto escuro
  - gerador de senha legível
  - checkbox/labels legíveis
  - botões desativados legíveis
  - botão fechar legível
- Tema Escuro mantém contraste explícito.

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
- Demais telas já ajustadas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-contraste-popup-item*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
