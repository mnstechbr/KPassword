KPassword v0.6.1 - ajustes pós-polimento

Ajustes incluídos:
- Clicar no app na barra de tarefas não envia mais para a bandeja.
- Minimizar agora mantém o app minimizado na barra de tarefas.
- Se a configuração de bloquear ao minimizar estiver ativa, o cofre bloqueia, mas a janela não é escondida na bandeja.
- Windows Hello tenta trazer a janela para frente antes de abrir o prompt.
- Dashboard passa a mostrar apenas o total de itens salvos por padrão.
- Botão "Mostrar mais" exibe os demais detalhes.
- Os detalhes da dashboard recolhem automaticamente após 1 minuto.
- Versão ajustada para 0.6.1.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v061-taskbar-hello-dashboard*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
