KPassword v0.7.1 - Login desktop premium e tipografia

Ajustes:
- Tela inicial/de login deixa de parecer app mobile preso em um card central.
- Login passa a usar a janela inteira com visual desktop em duas áreas.
- Área esquerda: logo, identidade, mensagem local/offline/criptografado e cofre ativo.
- Área direita: painel de senha mestra e PIN/biometria do computador.
- Topo: marca KPassword e botão Ajustes rápidos.
- Ajustes rápidos antes do desbloqueio: tema, idioma, selecionar/criar cofre e restaurar backup.
- Tipografia geral refinada para reduzir aparência de Word/Excel.
- Títulos com mais peso visual, melhor espaçamento e hierarquia.
- Mantém Senha mestra como termo principal.
- Mantém PIN/biometria do computador no lugar de Windows Hello nos textos visíveis.
- Versão ajustada para 0.7.1.

Não altera:
- Cofre
- Criptografia
- TOTP
- Multi-cofres
- PIN/biometria do computador
- Backup
- Updater
- Regras de segurança

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v071-login-premium-tipografia*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
