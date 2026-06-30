KPassword v0.6.1 - hotfix Windows Hello em primeiro plano

Corrige:
- O prompt do Windows Hello ficava piscando na barra de tarefas e só abria ao clicar.

Ajuste:
- Antes de chamar o Windows Hello, o KPassword mostra, desminimiza, coloca foco e fica temporariamente "sempre no topo".
- Depois que o Windows Hello termina, o app volta ao comportamento normal.
- Aplica ao desbloqueio com Windows Hello e à ativação do Windows Hello.

Não altera:
- Cofre
- Criptografia
- TOTP
- Multi-cofres
- Backup
- Updater
- Dashboard
- Idiomas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v061-hotfix-hello-em-primeiro-plano*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
