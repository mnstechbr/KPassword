KPassword v0.2.0 - Base segura local

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-vault-secure-base*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm install
npm run tauri dev

Incluído:
- Tela de criação da senha mestra.
- Tela de desbloqueio.
- Cofre local criptografado.
- AES-GCM 256-bit.
- PBKDF2-SHA-256 com 450.000 iterações.
- Salt individual de 32 bytes.
- IV novo em cada salvamento.
- Arquivo local vault.kpvault.
- Backups locais criptografados.
- Dashboard.
- Lista de credenciais.
- Adicionar/editar/excluir credenciais.
- Gerador de senhas fortes.
- Busca.
- Favoritos.
- Copiar usuário/senha com limpeza automática da área de transferência.
- Bloqueio ao minimizar, fechar ou ficar 3 minutos inativo.
- Som e notificação ao ir para a bandeja.
- Instância única.
- Inicialização junto com Windows.
