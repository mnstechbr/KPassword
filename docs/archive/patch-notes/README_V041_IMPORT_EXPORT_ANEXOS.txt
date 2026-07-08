KPassword v0.4.1

Inclui:
- Importação CSV genérica.
- Exportação JSON criptografada.
- Exportação CSV aberto com confirmação por senha mestra e alerta forte.
- Anexos criptografados em qualquer item do cofre.
- Textos novos em PT/EN/ES/TR.
- Versão ajustada para 0.4.1.

Aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v041-import-export-anexos*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
