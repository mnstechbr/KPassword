KPassword - correção de tela branca

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-blank-screen*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Correção:
- Corrigidas funções auxiliares que faltaram no App.tsx.
- Removidas sobras do drag/drop antigo que quebravam a tela.
- Mantida a nova página Configurações.
- Mantidos os botões ↑ e ↓ para reorganizar credenciais.
