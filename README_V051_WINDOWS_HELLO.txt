KPassword v0.5.1 - Windows Hello opcional

Recursos:
- Windows Hello opcional por cofre.
- Primeiro desbloqueio continua sendo pela senha mestra.
- Depois de ativado, o cofre pode ser desbloqueado com Windows Hello.
- Fallback pela senha mestra sempre disponível.
- Ativar/desativar em Segurança & backup > Configurações de segurança.
- Ao trocar a senha mestra, o Windows Hello é atualizado; se a confirmação for cancelada, ele é desativado para evitar senha antiga.
- Cada cofre tem configuração própria do Windows Hello.
- Textos PT/EN/ES/TR.
- Versão ajustada para 0.5.1.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v051-windows-hello*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

Observação:
No primeiro build, o Cargo pode baixar as dependências Windows usadas para chamar o Windows Hello e DPAPI.
