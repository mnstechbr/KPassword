KPassword v0.7.0 - hotfix cabeçalho modal novo item

Corrige:
- A faixa retangular/sticky também aparecia no modal de cadastrar novo item.
- O conteúdo do formulário parecia passar por baixo do cabeçalho ao rolar.

Ajuste:
- Remove o comportamento sticky do cabeçalho do modal de novo/editar item.
- Mantém uma separação visual simples, sem faixa sobreposta.
- Mantém o mesmo tratamento aplicado anteriormente ao detalhe da credencial.

Não altera:
- Cofre
- Criptografia
- PIN/biometria do computador
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas
- Analítico

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v070-hotfix-modal-novo-item-header*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
