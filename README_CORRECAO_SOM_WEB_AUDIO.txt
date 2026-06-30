Correção do som do KPassword

O som agora é gerado pelo próprio app usando Web Audio API.
Não depende mais do som customizado do toast do Windows nem de arquivo .wav.

Como aplicar via PowerShell:
$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-web-audio-sound*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev
