KPassword v0.7.0 - Produto final, ajuda, sobre e qualidade

Inclui:
- Página Ajuda / Guia rápido.
- Página Sobre o KPassword.
- Exemplos práticos do que o app resolve.
- Aviso claro de segurança local/offline.
- Checklist de segurança.
- Botão Abrir pasta do cofre atual.
- Botão Abrir pasta de backups.
- Exportar relatório de saúde do cofre sem senhas, 2FA ou anexos.
- Indicador visual do cofre atual no topo.
- Tela de primeiro uso com guia inicial.
- Dashboard: o card "Total" vira o próprio botão Mostrar mais.
- Textos novos em PT / EN / ES / TR.
- Versão ajustada para 0.7.0.

Como aplicar:
$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v070-produto-final-ajuda-sobre*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
