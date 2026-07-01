KPassword v0.8.1 - hotfix bandeja e inatividade

Corrige a lógica em que o app enviava a notificação correta ao ir para a bandeja e, depois do tempo de inatividade, enviava outra notificação como se ainda estivesse aberto.

Ajuste aplicado:
- Ao enviar para a bandeja, o temporizador de inatividade é pausado.
- Enquanto a janela estiver oculta ou minimizada, o app não dispara a regra de ausência.
- O temporizador só volta quando a janela é aberta novamente.
- Evita notificação duplicada de inatividade.
- Atualiza a versão para 0.8.1.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v081-hotfix-bandeja-inatividade*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

Validação:
1. Abra o app e desbloqueie o cofre.
2. Feche no X para mandar para a bandeja.
3. Confirme que aparece só a notificação da bandeja.
4. Espere mais tempo que o bloqueio automático, por exemplo 3 minutos.
5. Confirme que NÃO aparece a notificação de inatividade.
6. Abra pela bandeja em modo completo ou compacto.
7. Confirme que o app continua bloqueado e funcionando.
