KPassword v0.7.1 - hotfix tema conectado, logo e PIN

Ajustes:
- Os três botões de tema viram um controle conectado com ícones:
  - lua para escuro
  - sol para claro
  - meio círculo para misto
- O botão de PIN/biometria fica curto: "Acessar com PIN"
- Remove o ícone pequeno inútil do botão de PIN.
- Remove o nome "KPassword" da marca interna, já que a barra superior do app já mostra o nome.
- Usa a logo como elemento visual principal no hero, com uma linha de segurança própria.
- Reduz o peso visual do título.
- Revisa o modo misto para evitar container claro com texto claro ou container escuro com texto escuro.

Não altera:
- Cofre
- Criptografia
- PIN/biometria em si
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-hotfix-login-tema-logo-pin*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
