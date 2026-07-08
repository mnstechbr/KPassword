KPassword - corrigir async duplicado na v0.3.3

Erro corrigido:
- async async function handleSaveCredential
- async async function handleDeleteCredential
- async async function moveCredentialByOffset

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-v033-async-duplicado*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-v033-async-duplicado.ps1"

npm run build
npm run tauri dev

Observação:
Se o npm run tauri dev ainda estiver rodando com erro em outro terminal, pare com Ctrl+C antes de aplicar.
