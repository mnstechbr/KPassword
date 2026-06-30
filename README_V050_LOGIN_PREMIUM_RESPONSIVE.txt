KPassword v0.5.0 - Login premium responsivo

Ajustes:
- Move o seletor de cofres para o final do card de login/criação/desbloqueio.
- Mantém idioma no topo.
- Mantém logo e identidade visual.
- Centraliza o bloco principal de login.
- Melhora espaçamento, brilho, bordas e hierarquia visual.
- Evita corte quando a janela fica menor.
- Mantém o card rolável quando a altura for insuficiente.
- Não altera regras de cofre, TOTP, multi-cofres, backup, updater ou idiomas.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v050-login-premium-responsive*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
