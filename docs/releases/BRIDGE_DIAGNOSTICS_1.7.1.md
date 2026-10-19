# Diagnóstico do Secrets Bridge — 19/10/2026

Leitura local, sem modificar registros ou cofres e sem copiar corpos, chaves ou
identidades dos consumidores para este relatório. O histórico consultado cobre
11 a 19 de outubro de 2026. Datas abaixo usam America/Sao_Paulo.

| Data | Aprovações | Respostas entregues | Recusas |
| --- | ---: | ---: | ---: |
| 11/10 | 13 | 13 | 0 |
| 13/10 | 13 | 13 | 0 |
| 14/10 | 2 | 2 | 0 |
| 16/10 | 116 | 116 | 0 |
| 18/10 | 183 | 177 | 2 |
| 19/10 | 127 | 125 | 0 |
| Total | 454 | 446 | 2 |

O arquivo tinha 902 eventos no momento da leitura. Há oito aprovações a mais
que entregas, distribuídas em 18 e 19/10. Isso não comprova a causa nem o erro de
cada tentativa: a versão anterior só gravava `approved`, `delivered` e `denied`.
Ela não registrava quotas rejeitadas, status do provedor, falhas de rede ou o
encerramento de cada pedido. As duas recusas também não têm motivo discriminado.
O log atual do backend KOMA não contém códigos do Bridge que permitam completar
essa atribuição. Não é possível determinar retroativamente se o bloqueio relatado
foi o da janela por minuto ou o da janela por hora.

Problemas comprovados no código e tratados na 1.7.1:

1. Limites fixos de 60 chamadas/minuto e 524.288 tokens reservados/hora por
   credencial, mais limites por permissão e por token HTTP. O token HTTP impunha
   ainda 131.072 tokens/hora, suficiente para bloquear após 16 reservas de 8.192.
2. Reservas definitivas pelo máximo solicitado, inclusive após erro ou resposta
   curta. O bloqueio não discriminava janela, saldo ou momento de retomada.
3. A identidade usada nas permissões HTTP/MCP incorporava token e sessão MCP,
   provocando reaprovação do mesmo aplicativo/projeto após reconexão.
4. O popup podia esconder um pedido novo ao finalizar a resposta ao anterior.
5. O arquivo de auditoria recusava novas gravações ao ultrapassar 10 MB; como
   a entrega depende da gravação, isso acabaria bloqueando aplicações autorizadas.
   O arquivo consultado ainda não tinha atingido esse tamanho.

Não foram atribuídos erros antigos a esses problemas sem evidência. A nova
versão registra códigos filtrados e status para que as próximas falhas possam
ser diagnosticadas. Não registra prompts, respostas, headers ou credenciais.
