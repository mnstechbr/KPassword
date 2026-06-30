KPassword v0.3.3 - hotfix de espaçamento

Corrige o espaçamento interno do container:
Segurança & backup > Configurações de segurança

Ajusta:
- Espaço entre campos numéricos
- Espaço entre os toggles
- Espaço entre título/descrição/controles
- Espaço da grade informativa final
- Comportamento responsivo

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-v033-espacamento-seguranca*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-v033-espacamento-seguranca.ps1"

npm run build
npm run tauri dev
