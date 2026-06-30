KPassword - senha mestra, importação de backup, atualizações e correção visual

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-security-backup-update-fixes*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run tauri dev

Incluído/corrigido:
- Botão Bloquear cofre corrigido no menu lateral fechado.
- Área de alteração da senha mestra com confirmação.
- Lembrete não obrigatório para troca da senha mestra a cada 30 dias.
- Importação/restauração de backup .kpvault na tela bloqueada/primeiro acesso e na página Segurança & Backup.
- Página Configurações com verificação básica de releases públicas no GitHub.
- Explicação no app de que não existe recuperação da senha mestra se ela for perdida.
- Backups antigos continuam exigindo a senha usada quando foram criados.
