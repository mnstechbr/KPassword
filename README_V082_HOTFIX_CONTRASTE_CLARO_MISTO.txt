KPassword v0.8.2 - hotfix contraste tema Claro/Misto

Corrige:
- Botao "Acessar com PIN" no login claro/misto.
- Botao "Excluir definitivamente" na lixeira claro/misto.
- Lista do Cofre com textos/botoes brancos sobre fundo branco.
- Acoes de credenciais: copiar usuario, copiar senha, editar.
- Detalhe da credencial com botoes apagados.
- Cards claros herdando texto branco.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v082-hotfix-contraste-claro-misto*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\apply-v082-contrast-light-mixed.ps1"

npm run build
npm run tauri dev
