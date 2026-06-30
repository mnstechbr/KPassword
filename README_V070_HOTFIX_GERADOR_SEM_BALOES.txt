KPassword v0.7.0 - hotfix gerador sem balões

Corrige:
- Os controles do gerador dentro do popup de Adicionar/Editar item estavam com aparência de balões/pílulas.
- Os checkboxes ficavam grandes demais visualmente e destoavam do modal.

Ajuste:
- Reduz o arredondamento dos controles do gerador.
- Troca as pílulas por opções retangulares compactas.
- Melhora espaçamento e alinhamento dos checkboxes.
- Mantém responsividade em janelas menores.

Não altera:
- Cofre
- Criptografia
- PIN/biometria do computador
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas
- Analítico

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v070-hotfix-gerador-sem-baloes*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
